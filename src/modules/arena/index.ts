/**
 * ArenaOrchestrator — central coordinator for the Model Arena.
 *
 * Initializes one grammy Bot instance per arena bot token, routes incoming
 * messages, dispatches LLM calls in parallel, and manages the grading/reporting
 * cron. Runs on the NanoClaw host (not in agent containers), bypassing the
 * channel-registry model — the arena's independent bots don't fit one-bot-per-
 * channel-type. Owns its own `data/arena.db` (opened in start()).
 */

import crypto from 'crypto';
import https from 'https';
import path from 'path';

import Database from 'better-sqlite3';
import { Api, Bot } from 'grammy';
import { CronExpressionParser } from 'cron-parser';

import { log } from '../../log.js';
import { DATA_DIR, TIMEZONE } from '../../config.js';
import {
  ARENA_CHAT_ID,
  ARENA_ENABLED,
  SEND_STAGGER_MS,
  SYSTEM_PROMPT_VERSION,
  GRADING_CRON,
  REPORT_CRON,
  buildBotConfigs,
} from './arena-config.js';
import { classifyMessage, extractRating } from './arena-router.js';
import { callModel } from './arena-model.js';
import * as arenaDb from './arena-db.js';
import { runDailyGrading } from './arena-grader.js';
import { generateReport } from './arena-report.js';
import type { ArenaBotConfig, ChatMessage, RoutingType } from './types.js';

const TELEGRAM_MAX_LENGTH = 4096;

/** Send a message with Telegram Markdown, falling back to plain text.
 *  Splits messages that exceed Telegram's 4096 char limit. */
async function sendArenaMessage(
  api: Api,
  chatId: number,
  text: string,
  options: { reply_to_message_id?: number } = {},
): Promise<number> {
  const chunks: string[] = [];
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    chunks.push(text);
  } else {
    for (let i = 0; i < text.length; i += TELEGRAM_MAX_LENGTH) {
      chunks.push(text.slice(i, i + TELEGRAM_MAX_LENGTH));
    }
  }

  let lastMsgId = 0;
  for (const chunk of chunks) {
    try {
      const msg = await api.sendMessage(chatId, chunk, {
        ...options,
        parse_mode: 'Markdown',
      });
      lastMsgId = msg.message_id;
    } catch {
      const msg = await api.sendMessage(chatId, chunk, options);
      lastMsgId = msg.message_id;
    }
  }
  return lastMsgId;
}

class ArenaOrchestrator {
  private bots = new Map<string, { config: ArenaBotConfig; bot: Bot; api: Api }>();

  /** Map Telegram user ID → bot config (populated after getMe). */
  private botsByTelegramId = new Map<number, ArenaBotConfig>();

  /** Map @username (lowercase) → bot config. */
  private botsByUsername = new Map<string, ArenaBotConfig>();

  /** In-memory conversation cache: "botId:chatId" → ChatMessage[] */
  private conversationCache = new Map<string, ChatMessage[]>();

  /** Module-owned arena.db handle, closed on stop(). */
  private arenaDatabase: import('better-sqlite3').Database | null = null;

  private cronInterval: ReturnType<typeof setInterval> | null = null;
  /** Initialized to now so cron doesn't fire immediately on startup. */
  private lastGradingRun: string = new Date().toISOString();
  private lastReportRun: string = new Date().toISOString();

  async start(): Promise<void> {
    if (!ARENA_ENABLED) {
      log.info('Arena disabled (ARENA_ENABLED != true)');
      return;
    }

    // Open the module-owned arena DB and create its schema.
    const dbPath = path.join(DATA_DIR, 'arena.db');
    this.arenaDatabase = new Database(dbPath);
    arenaDb.initArenaDb(this.arenaDatabase);

    const configs = buildBotConfigs();
    if (configs.length === 0) {
      log.warn('Arena: no bot tokens configured, skipping');
      return;
    }

    log.info('Arena: initializing bots', { botCount: configs.length });

    for (const config of configs) {
      try {
        const bot = new Bot(config.token, {
          client: {
            baseFetchConfig: { agent: https.globalAgent, compress: true },
          },
        });
        const api = new Api(config.token);

        // Verify bot identity
        const me = await api.getMe();
        config.telegramUserId = me.id;

        if (me.username?.toLowerCase() !== config.username.toLowerCase()) {
          log.warn('Arena bot username mismatch', {
            botId: config.id,
            expected: config.username,
            actual: me.username,
          });
        }

        // Register in lookup maps
        this.botsByTelegramId.set(me.id, config);
        this.botsByUsername.set(config.username.toLowerCase(), config);

        // Set up message handler — only process messages from the arena group
        bot.on('message:text', (ctx) => {
          if (ctx.chat.id !== ARENA_CHAT_ID) return;
          // Only the first bot to see a message should process it
          // We use the first bot in our map as the "primary" handler
          const primaryBot = [...this.bots.values()][0];
          if (primaryBot?.config.id !== config.id) return;

          this.handleMessage(ctx.message).catch((err) =>
            log.error('Arena message handler error', { err, botId: config.id }),
          );
        });

        // Set up reaction handler
        bot.on('message_reaction', (ctx) => {
          if (ctx.messageReaction.chat.id !== ARENA_CHAT_ID) return;
          const primaryBot = [...this.bots.values()][0];
          if (primaryBot?.config.id !== config.id) return;

          this.handleReaction(ctx.messageReaction).catch((err) => log.error('Arena reaction handler error', { err }));
        });

        this.bots.set(config.id, { config, bot, api });

        log.info('Arena bot initialized', {
          botId: config.id,
          username: me.username,
          telegramId: me.id,
        });
      } catch (err) {
        log.error('Arena: failed to initialize bot', { botId: config.id, err });
      }
    }

    if (this.bots.size === 0) {
      log.warn('Arena: no bots initialized successfully');
      return;
    }

    // Start all bot polling loops
    for (const [botId, { bot }] of this.bots) {
      bot.start({
        allowed_updates: ['message', 'message_reaction'],
        onStart: () => log.info('Arena bot polling started', { botId }),
      });
    }

    // Start cron ticker for grading + reports
    this.cronInterval = setInterval(() => this.cronTick(), 60_000);

    log.info('Arena started', {
      activeBots: this.bots.size,
      totalConfigured: configs.length,
    });
  }

  async stop(): Promise<void> {
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
      this.cronInterval = null;
    }

    for (const [botId, { bot }] of this.bots) {
      try {
        bot.stop();
        log.info('Arena bot stopped', { botId });
      } catch (err) {
        log.error('Arena bot stop error', { botId, err });
      }
    }

    this.bots.clear();
    this.botsByTelegramId.clear();
    this.botsByUsername.clear();
    this.conversationCache.clear();

    if (this.arenaDatabase) {
      try {
        this.arenaDatabase.close();
      } catch (err) {
        log.error('Arena DB close error', { err });
      }
      this.arenaDatabase = null;
    }
  }

  // --- Message handling ---

  private async handleMessage(message: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number };
    text?: string;
    reply_to_message?: { from?: { id: number }; message_id: number };
    entities?: Array<{ type: string; offset: number; length: number }>;
    date: number;
  }): Promise<void> {
    if (!message.text || !message.from) return;

    // Ignore messages from arena bots themselves
    if (this.botsByTelegramId.has(message.from.id)) return;

    const routing = classifyMessage(message, this.botsByTelegramId, this.botsByUsername);

    log.info('Arena message received', {
      routingType: routing.type,
      targetBots: routing.targetBotIds,
      userId: message.from.id,
      text: message.text.slice(0, 100),
    });

    if (routing.type === 'broadcast') {
      await this.handleBroadcast(message, routing.type);
    } else {
      await this.handleTargeted(message, routing.targetBotIds, routing.type, routing.replyToMessageId);
    }
  }

  private async handleBroadcast(
    message: {
      message_id: number;
      from?: { id: number };
      chat: { id: number };
      text?: string;
    },
    routingType: RoutingType,
  ): Promise<void> {
    const sessionId = crypto.randomUUID();
    const activeBotIds = [...this.bots.keys()];

    arenaDb.insertSession({
      sessionId,
      userId: message.from!.id,
      userMessage: message.text!,
      routingType,
      targetedBots: null,
      botCount: activeBotIds.length,
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
    });

    const results = await Promise.allSettled(
      activeBotIds.map((botId, index) => this.respondWithBot(botId, message, sessionId, true, null, index)),
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const botId = activeBotIds[i];
        const reason = results[i].status === 'rejected' ? (results[i] as PromiseRejectedResult).reason : null;
        log.error('Arena broadcast: bot failed', { botId, err: reason });
      }
    }
  }

  private async handleTargeted(
    message: {
      message_id: number;
      from?: { id: number };
      chat: { id: number };
      text?: string;
    },
    targetBotIds: string[],
    routingType: RoutingType,
    replyToMessageId?: number,
  ): Promise<void> {
    const sessionId = crypto.randomUUID();

    // If reply-to, update user_replied on the original log entry
    if (routingType === 'reply-to' && replyToMessageId) {
      arenaDb.markUserReplied(replyToMessageId, message.chat.id);
    }

    arenaDb.insertSession({
      sessionId,
      userId: message.from!.id,
      userMessage: message.text!,
      routingType,
      targetedBots: targetBotIds,
      botCount: targetBotIds.length,
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
    });

    // Find parent_log_id for reply-to routing
    let parentLogId: number | null = null;
    if (routingType === 'reply-to' && replyToMessageId) {
      const parentLog = arenaDb.getLogByTelegramMessage(replyToMessageId, message.chat.id);
      if (parentLog) parentLogId = parentLog.id;
    }

    const results = await Promise.allSettled(
      targetBotIds.map((botId, index) => this.respondWithBot(botId, message, sessionId, false, parentLogId, index)),
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        log.error('Arena targeted: bot failed', {
          botId: targetBotIds[i],
          err: (results[i] as PromiseRejectedResult).reason,
        });
      }
    }
  }

  private async respondWithBot(
    botId: string,
    message: {
      message_id: number;
      from?: { id: number };
      chat: { id: number };
      text?: string;
    },
    sessionId: string,
    isBroadcast: boolean,
    parentLogId: number | null,
    sendIndex: number,
  ): Promise<void> {
    const entry = this.bots.get(botId);
    if (!entry) return;

    const { config, api } = entry;
    const startTime = Date.now();

    // Build conversation history
    const history = this.getConversationHistory(botId, parentLogId);

    let logId: number;
    try {
      const response = await callModel(config, history, message.text!, sessionId);

      // Strip hallucinated tool call XML (some models generate fake tool syntax)
      response.text = response.text
        .replace(/<[a-z_]+:tool_call>[\s\S]*?<\/[a-z_]+:tool_call>/g, '')
        .replace(/<invoke\b[\s\S]*?<\/invoke>/g, '')
        .trim();

      if (!response.text) {
        throw new Error(`${config.model} produced empty response after sanitization`);
      }

      // Stagger sends
      if (sendIndex > 0) {
        await new Promise((r) => setTimeout(r, sendIndex * SEND_STAGGER_MS));
      }

      // Send response — prefix with model name for broadcast
      const prefix = isBroadcast ? `*${config.displayName}:*\n` : '';
      const telegramMsgId = await sendArenaMessage(api, message.chat.id, `${prefix}${response.text}`, {
        reply_to_message_id: message.message_id,
      });

      // Log to DB
      logId = arenaDb.insertLog({
        sessionId,
        botId,
        model: config.model,
        chatId: message.chat.id,
        userId: message.from!.id,
        telegramMessageId: telegramMsgId,
        parentLogId,
        promptText: message.text!,
        historyJson: JSON.stringify(history),
        responseText: response.text,
        toolCallsJson: response.toolCalls ? JSON.stringify(response.toolCalls) : null,
        tokensIn: response.usage?.prompt_tokens ?? null,
        tokensOut: response.usage?.completion_tokens ?? null,
        litellmRequestId: response.requestId ?? null,
        latencyMs: Date.now() - startTime,
        isBroadcast,
        error: null,
      });
      void logId;

      // Update conversation cache
      const cacheKey = `${botId}:${message.chat.id}`;
      const cached = this.conversationCache.get(cacheKey) ?? [];
      cached.push({ role: 'user', content: message.text! }, { role: 'assistant', content: response.text });
      // Keep last 40 messages (20 turns)
      if (cached.length > 40) cached.splice(0, cached.length - 40);
      this.conversationCache.set(cacheKey, cached);

      log.info('Arena bot responded', {
        botId,
        model: config.model,
        latencyMs: Date.now() - startTime,
        tokensOut: response.usage?.completion_tokens,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Log the error
      arenaDb.insertLog({
        sessionId,
        botId,
        model: config.model,
        chatId: message.chat.id,
        userId: message.from!.id,
        telegramMessageId: null,
        parentLogId,
        promptText: message.text!,
        historyJson: JSON.stringify(history),
        responseText: null,
        toolCallsJson: null,
        tokensIn: null,
        tokensOut: null,
        litellmRequestId: null,
        latencyMs: Date.now() - startTime,
        isBroadcast,
        error: errorMsg,
      });

      // Send error message to user
      try {
        await sendArenaMessage(api, message.chat.id, `${config.displayName} is unavailable for this session.`, {
          reply_to_message_id: message.message_id,
        });
      } catch {
        // If even the error message fails, just log it
      }

      throw err; // Re-throw for Promise.allSettled
    }
  }

  private getConversationHistory(botId: string, parentLogId: number | null): ChatMessage[] {
    // For reply-to with a known parent, reconstruct from DB
    if (parentLogId) {
      const chain = arenaDb.getConversationChain(parentLogId);
      const messages: ChatMessage[] = [];
      for (const logRow of chain) {
        messages.push({ role: 'user', content: logRow.prompt_text });
        if (logRow.response_text) {
          messages.push({ role: 'assistant', content: logRow.response_text });
        }
      }
      return messages;
    }

    // For broadcast, use the in-memory cache (or empty for first message)
    const cacheKey = `${botId}:${ARENA_CHAT_ID}`;
    return this.conversationCache.get(cacheKey) ?? [];
  }

  // --- Reaction handling ---

  private async handleReaction(reaction: {
    chat: { id: number };
    message_id: number;
    user?: { id: number };
    new_reaction?: Array<{ type: string; emoji?: string }>;
  }): Promise<void> {
    const rating = extractRating(reaction.new_reaction);
    if (rating === 0) return;

    arenaDb.updateRating(reaction.message_id, reaction.chat.id, rating);
    log.debug('Arena reaction recorded', {
      messageId: reaction.message_id,
      rating,
      userId: reaction.user?.id,
    });
  }

  // --- Cron scheduling ---

  private cronTick(): void {
    const now = new Date();

    // Check daily grading
    if (this.shouldRun(GRADING_CRON, this.lastGradingRun, now)) {
      this.lastGradingRun = now.toISOString();
      runDailyGrading().catch((err) => log.error('Arena daily grading failed', { err }));
    }

    // Check weekly report
    if (this.shouldRun(REPORT_CRON, this.lastReportRun, now)) {
      this.lastReportRun = now.toISOString();
      this.sendWeeklyReport().catch((err) => log.error('Arena weekly report failed', { err }));
    }
  }

  private shouldRun(cronExpr: string, lastRun: string, now: Date): boolean {
    try {
      const cron = CronExpressionParser.parse(cronExpr, { tz: TIMEZONE });
      const prev = cron.prev();
      const prevTime = prev.toDate().getTime();

      // Should run if the previous cron time is after our last run
      return prevTime > new Date(lastRun).getTime();
    } catch {
      return false;
    }
  }

  private async sendWeeklyReport(): Promise<void> {
    const report = await generateReport({ days: 7 });
    // TODO: deliver the report into the arena chat (or an owner DM) via the
    // host delivery path; v1 left this as a log-only TODO too.
    log.info('Arena weekly report generated', { reportLength: report.length });
  }

  /** Generate an on-demand report. */
  async getOnDemandReport(days: number): Promise<string> {
    return generateReport({ days });
  }
}

export const arenaOrchestrator = new ArenaOrchestrator();

/** Start the arena (no-op unless ARENA_ENABLED). Called from src/index.ts. */
export async function startArena(): Promise<void> {
  await arenaOrchestrator.start();
}

/** Stop the arena and close its DB. Called from src/index.ts shutdown(). */
export async function stopArena(): Promise<void> {
  await arenaOrchestrator.stop();
}
