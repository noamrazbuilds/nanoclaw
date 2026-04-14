/**
 * ArenaOrchestrator — central coordinator for the Model Arena.
 *
 * Initializes 5 grammy Bot instances (one per arena bot token),
 * routes incoming messages, dispatches LLM calls in parallel,
 * and manages the grading/reporting cron.
 */

import crypto from 'crypto';
import https from 'https';
import { Api, Bot } from 'grammy';
import { CronExpressionParser } from 'cron-parser';

import { logger } from '../logger.js';
import { getDatabase } from '../db.js';
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
import { TIMEZONE } from '../config.js';

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
  private bots = new Map<
    string,
    { config: ArenaBotConfig; bot: Bot; api: Api }
  >();

  /** Map Telegram user ID → bot config (populated after getMe). */
  private botsByTelegramId = new Map<number, ArenaBotConfig>();

  /** Map @username (lowercase) → bot config. */
  private botsByUsername = new Map<string, ArenaBotConfig>();

  /** In-memory conversation cache: "botId:chatId" → ChatMessage[] */
  private conversationCache = new Map<string, ChatMessage[]>();

  private cronInterval: ReturnType<typeof setInterval> | null = null;
  /** Initialized to now so cron doesn't fire immediately on startup. */
  private lastGradingRun: string = new Date().toISOString();
  private lastReportRun: string = new Date().toISOString();

  async start(): Promise<void> {
    if (!ARENA_ENABLED) {
      logger.info('Arena disabled (ARENA_ENABLED != true)');
      return;
    }

    // Initialize arena DB module with the shared database instance
    arenaDb.initArenaDb(getDatabase());

    const configs = buildBotConfigs();
    if (configs.length === 0) {
      logger.warn('Arena: no bot tokens configured, skipping');
      return;
    }

    logger.info({ botCount: configs.length }, 'Arena: initializing bots');

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
          logger.warn(
            {
              botId: config.id,
              expected: config.username,
              actual: me.username,
            },
            'Arena bot username mismatch',
          );
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
            logger.error(
              { err, botId: config.id },
              'Arena message handler error',
            ),
          );
        });

        // Set up reaction handler
        bot.on('message_reaction', (ctx) => {
          if (ctx.messageReaction.chat.id !== ARENA_CHAT_ID) return;
          const primaryBot = [...this.bots.values()][0];
          if (primaryBot?.config.id !== config.id) return;

          this.handleReaction(ctx.messageReaction).catch((err) =>
            logger.error({ err }, 'Arena reaction handler error'),
          );
        });

        this.bots.set(config.id, { config, bot, api });

        logger.info(
          {
            botId: config.id,
            username: me.username,
            telegramId: me.id,
          },
          'Arena bot initialized',
        );
      } catch (err) {
        logger.error(
          { botId: config.id, err },
          'Arena: failed to initialize bot',
        );
      }
    }

    if (this.bots.size === 0) {
      logger.warn('Arena: no bots initialized successfully');
      return;
    }

    // Start all bot polling loops
    for (const [botId, { bot }] of this.bots) {
      bot.start({
        allowed_updates: ['message', 'message_reaction'],
        onStart: () => logger.info({ botId }, 'Arena bot polling started'),
      });
    }

    // Start cron ticker for grading + reports
    this.cronInterval = setInterval(() => this.cronTick(), 60_000);

    logger.info(
      { activeBots: this.bots.size, totalConfigured: configs.length },
      'Arena started',
    );
  }

  async stop(): Promise<void> {
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
      this.cronInterval = null;
    }

    for (const [botId, { bot }] of this.bots) {
      try {
        bot.stop();
        logger.info({ botId }, 'Arena bot stopped');
      } catch (err) {
        logger.error({ botId, err }, 'Arena bot stop error');
      }
    }

    this.bots.clear();
    this.botsByTelegramId.clear();
    this.botsByUsername.clear();
    this.conversationCache.clear();
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

    const routing = classifyMessage(
      message,
      this.botsByTelegramId,
      this.botsByUsername,
    );

    logger.info(
      {
        routingType: routing.type,
        targetBots: routing.targetBotIds,
        userId: message.from.id,
        text: message.text.slice(0, 100),
      },
      'Arena message received',
    );

    if (routing.type === 'broadcast') {
      await this.handleBroadcast(message, routing.type);
    } else {
      await this.handleTargeted(
        message,
        routing.targetBotIds,
        routing.type,
        routing.replyToMessageId,
      );
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
      activeBotIds.map((botId, index) =>
        this.respondWithBot(botId, message, sessionId, true, null, index),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const botId = activeBotIds[i];
        const reason =
          results[i].status === 'rejected'
            ? (results[i] as PromiseRejectedResult).reason
            : null;
        logger.error({ botId, err: reason }, 'Arena broadcast: bot failed');
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
      const parentLog = arenaDb.getLogByTelegramMessage(
        replyToMessageId,
        message.chat.id,
      );
      if (parentLog) parentLogId = parentLog.id;
    }

    const results = await Promise.allSettled(
      targetBotIds.map((botId, index) =>
        this.respondWithBot(
          botId,
          message,
          sessionId,
          false,
          parentLogId,
          index,
        ),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        logger.error(
          {
            botId: targetBotIds[i],
            err: (results[i] as PromiseRejectedResult).reason,
          },
          'Arena targeted: bot failed',
        );
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
      const response = await callModel(
        config,
        history,
        message.text!,
        sessionId,
      );

      // Strip hallucinated tool call XML (some models generate fake tool syntax)
      response.text = response.text
        .replace(/<[a-z_]+:tool_call>[\s\S]*?<\/[a-z_]+:tool_call>/g, '')
        .replace(/<invoke\b[\s\S]*?<\/invoke>/g, '')
        .trim();

      if (!response.text) {
        throw new Error(
          `${config.model} produced empty response after sanitization`,
        );
      }

      // Stagger sends
      if (sendIndex > 0) {
        await new Promise((r) => setTimeout(r, sendIndex * SEND_STAGGER_MS));
      }

      // Send response — prefix with model name for broadcast
      const prefix = isBroadcast ? `*${config.displayName}:*\n` : '';
      const telegramMsgId = await sendArenaMessage(
        api,
        message.chat.id,
        `${prefix}${response.text}`,
        { reply_to_message_id: message.message_id },
      );

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
        toolCallsJson: response.toolCalls
          ? JSON.stringify(response.toolCalls)
          : null,
        tokensIn: response.usage?.prompt_tokens ?? null,
        tokensOut: response.usage?.completion_tokens ?? null,
        litellmRequestId: response.requestId ?? null,
        latencyMs: Date.now() - startTime,
        isBroadcast,
        error: null,
      });

      // Update conversation cache
      const cacheKey = `${botId}:${message.chat.id}`;
      const cached = this.conversationCache.get(cacheKey) ?? [];
      cached.push(
        { role: 'user', content: message.text! },
        { role: 'assistant', content: response.text },
      );
      // Keep last 40 messages (20 turns)
      if (cached.length > 40) cached.splice(0, cached.length - 40);
      this.conversationCache.set(cacheKey, cached);

      logger.info(
        {
          botId,
          model: config.model,
          latencyMs: Date.now() - startTime,
          tokensOut: response.usage?.completion_tokens,
        },
        'Arena bot responded',
      );
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
        await sendArenaMessage(
          api,
          message.chat.id,
          `${config.displayName} is unavailable for this session.`,
          { reply_to_message_id: message.message_id },
        );
      } catch {
        // If even the error message fails, just log it
      }

      throw err; // Re-throw for Promise.allSettled
    }
  }

  private getConversationHistory(
    botId: string,
    parentLogId: number | null,
  ): ChatMessage[] {
    // For reply-to with a known parent, reconstruct from DB
    if (parentLogId) {
      const chain = arenaDb.getConversationChain(parentLogId);
      const messages: ChatMessage[] = [];
      for (const log of chain) {
        messages.push({ role: 'user', content: log.prompt_text });
        if (log.response_text) {
          messages.push({ role: 'assistant', content: log.response_text });
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
    logger.debug(
      {
        messageId: reaction.message_id,
        rating,
        userId: reaction.user?.id,
      },
      'Arena reaction recorded',
    );
  }

  // --- Cron scheduling ---

  private cronTick(): void {
    const now = new Date();

    // Check daily grading
    if (this.shouldRun(GRADING_CRON, this.lastGradingRun, now)) {
      this.lastGradingRun = now.toISOString();
      runDailyGrading().catch((err) =>
        logger.error({ err }, 'Arena daily grading failed'),
      );
    }

    // Check weekly report
    if (this.shouldRun(REPORT_CRON, this.lastReportRun, now)) {
      this.lastReportRun = now.toISOString();
      this.sendWeeklyReport().catch((err) =>
        logger.error({ err }, 'Arena weekly report failed'),
      );
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
    // TODO: Send via The Dude IPC
    logger.info(
      { reportLength: report.length },
      'Arena weekly report generated',
    );
  }

  /** Generate an on-demand report (called via IPC from The Dude). */
  async getOnDemandReport(days: number): Promise<string> {
    return generateReport({ days });
  }
}

export const arenaOrchestrator = new ArenaOrchestrator();
