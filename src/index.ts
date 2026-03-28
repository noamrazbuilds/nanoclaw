import fs from 'fs';
import path from 'path';

import { OneCLI } from '@onecli-sh/sdk';

import {
  ASSISTANT_NAME,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TRIGGER,
  getTriggerPattern,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  ONECLI_URL,
  POLL_INTERVAL,
  TELEGRAM_BOT_POOL,
  TIMEZONE,
} from './config.js';
import './channels/index.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
} from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { ChannelType } from './text-styles.js';
import {
  restoreRemoteControl,
  startRemoteControl,
  stopRemoteControl,
} from './remote-control.js';
import {
  isSenderAllowed,
  isTriggerAllowed,
  loadSenderAllowlist,
  shouldDropMessage,
} from './sender-allowlist.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { parseImageReferences } from './image.js';
import { logger } from './logger.js';
import { parseSlotPrefix, slotSessionKey } from './slots.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

const channels: Channel[] = [];
const queue = new GroupQueue();

const onecli = new OneCLI({ url: ONECLI_URL });

function ensureOneCLIAgent(jid: string, group: RegisteredGroup): void {
  if (group.isMain) return;
  const identifier = group.folder.toLowerCase().replace(/_/g, '-');
  onecli.ensureAgent({ name: group.name, identifier }).then(
    (res: any) => {
      logger.info(
        { jid, identifier, created: res.created },
        'OneCLI agent ensured',
      );
    },
    (err: any) => {
      logger.debug(
        { jid, identifier, err: String(err) },
        'OneCLI agent ensure skipped',
      );
    },
  );
}

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Copy CLAUDE.md template into the new group folder so agents have
  // identity and instructions from the first run.  (Fixes #1391)
  const groupMdFile = path.join(groupDir, 'CLAUDE.md');
  if (!fs.existsSync(groupMdFile)) {
    const templateFile = path.join(
      GROUPS_DIR,
      group.isMain ? 'main' : 'global',
      'CLAUDE.md',
    );
    if (fs.existsSync(templateFile)) {
      let content = fs.readFileSync(templateFile, 'utf-8');
      if (ASSISTANT_NAME !== 'Andy') {
        content = content.replace(/^# Andy$/m, `# ${ASSISTANT_NAME}`);
        content = content.replace(/You are Andy/g, `You are ${ASSISTANT_NAME}`);
      }
      fs.writeFileSync(groupMdFile, content);
      logger.info({ folder: group.folder }, 'Created CLAUDE.md from template');
    }
  }

  // Ensure a corresponding OneCLI agent exists (best-effort, non-blocking)
  ensureOneCLIAgent(jid, group);

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

const VALID_MODELS = new Set(['opus', 'sonnet', 'haiku']);

interface ModelDirectives {
  model?: string;
  delegateModels: boolean;
}

// Slash command patterns
const MODEL_SLASH_RE = /\/model\s+(opus|sonnet|haiku)\b/i;
const DELEGATE_SLASH_RE = /\/delegate-models\b/i;

// Natural language patterns for model selection
// Matches: "use opus", "switch to haiku", "with opus", "respond with sonnet", "answer in opus"
const MODEL_NL_RE =
  /\b(?:use|switch\s+to|with|respond\s+(?:with|in|using)|answer\s+(?:with|in|using)|run\s+(?:with|in|on)|in)\s+(opus|sonnet|haiku)\b/i;

// Natural language patterns for model delegation
// Matches: "use different models", "delegate models", "pick the best model", "choose models for subtasks"
const DELEGATE_NL_RE =
  /\b(?:use\s+different\s+models|delegate\s+models|pick\s+(?:the\s+)?(?:best|right)\s+model|choose\s+models?\s+(?:for|per)|mix\s+models|multi[- ]?model)\b/i;

/**
 * Scan messages for model directives — slash commands or natural language.
 * Directives are stripped from message content in-place.
 */
function parseModelDirectives(
  messages: import('./types.js').NewMessage[],
): ModelDirectives {
  let model: string | undefined;
  let delegateModels = false;

  for (const msg of messages) {
    // Slash commands (take priority)
    const slashModel = msg.content.match(MODEL_SLASH_RE);
    if (slashModel) {
      model = slashModel[1].toLowerCase();
      msg.content = msg.content.replace(slashModel[0], '').trim();
    }
    if (DELEGATE_SLASH_RE.test(msg.content)) {
      delegateModels = true;
      msg.content = msg.content.replace(DELEGATE_SLASH_RE, '').trim();
    }

    // Natural language (only if slash command didn't match)
    if (!model) {
      const nlModel = msg.content.match(MODEL_NL_RE);
      if (nlModel) {
        model = nlModel[1].toLowerCase();
        msg.content = msg.content.replace(nlModel[0], '').trim();
      }
    }
    if (!delegateModels && DELEGATE_NL_RE.test(msg.content)) {
      delegateModels = true;
      // Don't strip NL delegation — it's often part of the actual instruction
    }
  }

  return { model, delegateModels };
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  const isMainGroup = group.isMain === true;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const triggerPattern = getTriggerPattern(group.trigger);
    const allowlistCfg = loadSenderAllowlist();
    const hasTrigger = missedMessages.some(
      (m) =>
        triggerPattern.test(m.content.trim()) &&
        (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
    );
    if (!hasTrigger) return true;
  }

  // Parse /model and /delegate-models directives (strips them from content)
  const directives = parseModelDirectives(missedMessages);

  const prompt = formatMessages(missedMessages, TIMEZONE);
  const imageAttachments = parseImageReferences(missedMessages);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(
    group,
    prompt,
    chatJid,
    imageAttachments,
    directives,
    async (result) => {
      // Streaming output callback — called for each agent result
      if (result.result) {
        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        logger.info({ group: group.name }, `Agent output: ${raw.length} chars`);
        if (text) {
          await channel.sendMessage(chatJid, text);
          outputSentToUser = true;
        }
        // Only reset idle timer on actual results, not session-update markers (result: null)
        resetIdleTimer();
      }

      if (result.status === 'success') {
        queue.notifyIdle(chatJid);
      }

      if (result.status === 'error') {
        hadError = true;
      }
    },
  );

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  return true;
}

/**
 * Process messages for a group via an overflow container.
 * Spawned when the primary container is busy, so the user gets a prompt response.
 * Uses a fresh session (no resume) and exits after a single turn.
 */
async function processOverflowMessages(chatJid: string): Promise<void> {
  const group = registeredGroups[chatJid];
  if (!group) return;

  const channel = findChannel(channels, chatJid);
  if (!channel) return;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const messages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
  if (messages.length === 0) return;

  const directives = parseModelDirectives(messages);
  const prompt = formatMessages(messages, TIMEZONE);
  const imageAttachments = parseImageReferences(messages);

  // Advance cursor so the primary container won't re-process these
  lastAgentTimestamp[chatJid] = messages[messages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: messages.length },
    'Processing overflow messages',
  );

  await channel.setTyping?.(chatJid, true);

  await runAgent(
    group,
    prompt,
    chatJid,
    imageAttachments,
    directives,
    async (result) => {
      if (result.result) {
        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        if (text) await channel.sendMessage(chatJid, text);
      }
    },
    { isOverflow: true },
  );

  await channel.setTyping?.(chatJid, false);
}

/**
 * Process messages for a slot container.
 * Slots are independent, long-running containers with their own sessions.
 * They linger for follow-up IPC messages just like the primary container.
 */
async function processSlotMessages(
  chatJid: string,
  slotId: string,
): Promise<void> {
  const group = registeredGroups[chatJid];
  if (!group) return;

  const channel = findChannel(channels, chatJid);
  if (!channel) return;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const messages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
  if (messages.length === 0) return;

  // Find the slot-prefixed messages and strip the prefix for the prompt
  // (the prefix was already parsed in the message loop, but DB has raw content)
  const directives = parseModelDirectives(messages);
  const prompt = formatMessages(messages, TIMEZONE);
  const imageAttachments = parseImageReferences(messages);

  const sessKey = slotSessionKey(group.folder, slotId);

  // Advance cursor
  lastAgentTimestamp[chatJid] = messages[messages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, slotId, messageCount: messages.length },
    'Processing slot messages',
  );

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name, slotId }, 'Slot idle timeout, closing');
      queue.closeSlot(chatJid, slotId);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);

  const isMain = group.isMain === true;
  const sessionId = sessions[sessKey];

  // Resolve model
  const resolvedModel =
    directives.model || group.containerConfig?.model || DEFAULT_MODEL;
  const resolvedFallback =
    group.containerConfig?.fallbackModel || DEFAULT_FALLBACK_MODEL;
  const allowDelegation =
    directives.delegateModels ||
    group.containerConfig?.allowModelDelegation === true;

  // Update snapshots
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      script: t.script || undefined,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
        model: resolvedModel,
        ...(resolvedFallback && { fallbackModel: resolvedFallback }),
        ...(allowDelegation && { allowModelDelegation: true }),
        ...(imageAttachments.length > 0 && { imageAttachments }),
        slotId,
        systemHint: `You are running in task slot "${slotId}". The user addresses this slot with #${slotId}. Stay focused on the task assigned to this slot.`,
      },
      (proc, containerName) =>
        queue.registerSlotProcess(
          chatJid,
          slotId,
          proc,
          containerName,
          group.folder,
        ),
      async (result) => {
        if (result.newSessionId) {
          sessions[sessKey] = result.newSessionId;
          setSession(sessKey, result.newSessionId);
        }
        if (result.result) {
          const raw =
            typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result);
          const text = raw
            .replace(/<internal>[\s\S]*?<\/internal>/g, '')
            .trim();
          if (text) {
            // Prefix slot responses so the user knows which slot replied
            const prefixed = `*[#${slotId}]*\n${text}`;
            await channel.sendMessage(chatJid, prefixed);
          }
          resetIdleTimer();
        }
        if (result.status === 'success') {
          queue.notifySlotIdle(chatJid, slotId);
        }
      },
    );

    if (output.newSessionId) {
      sessions[sessKey] = output.newSessionId;
      setSession(sessKey, output.newSessionId);
    }
  } catch (err) {
    logger.error({ group: group.name, slotId, err }, 'Slot agent error');
  }

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  imageAttachments: Array<{ relativePath: string; mediaType: string }>,
  directives: ModelDirectives = { delegateModels: false },
  onOutput?: (output: ContainerOutput) => Promise<void>,
  overflowOpts?: { isOverflow: boolean },
): Promise<'success' | 'error'> {
  const isMain = group.isMain === true;
  const isOverflow = overflowOpts?.isOverflow === true;
  const sessionId = isOverflow ? undefined : sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      script: t.script || undefined,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  // Overflow containers have throwaway sessions — don't save them
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (!isOverflow && output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    // Resolve model: message directive > per-group config > global default
    const resolvedModel =
      directives.model ||
      group.containerConfig?.model ||
      DEFAULT_MODEL;
    const resolvedFallback =
      group.containerConfig?.fallbackModel || DEFAULT_FALLBACK_MODEL;
    const allowDelegation =
      directives.delegateModels ||
      group.containerConfig?.allowModelDelegation === true;

    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
        model: resolvedModel,
        ...(resolvedFallback && { fallbackModel: resolvedFallback }),
        ...(allowDelegation && { allowModelDelegation: true }),
        ...(imageAttachments.length > 0 && { imageAttachments }),
        ...(isOverflow && {
          isOverflow: true,
          systemHint:
            'The user sent this while you were handling another request. Respond to this message specifically.',
        }),
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (default trigger: ${DEFAULT_TRIGGER})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
            continue;
          }

          const isMainGroup = group.isMain === true;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const triggerPattern = getTriggerPattern(group.trigger);
            const allowlistCfg = loadSenderAllowlist();
            const hasTrigger = groupMessages.some(
              (m) =>
                triggerPattern.test(m.content.trim()) &&
                (m.is_from_me ||
                  isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
            );
            if (!hasTrigger) continue;
          }

          // ── Slot routing ──────────────────────────────────────
          // Check the latest message for a slot prefix.
          // Only main groups support slots (non-main groups use triggers).
          const latestMsg = groupMessages[groupMessages.length - 1];
          const slotParse = isMainGroup
            ? parseSlotPrefix(latestMsg.content)
            : { type: 'primary' as const };

          if (slotParse.type === 'slot-list') {
            // #slots — list active slots
            const activeSlots = queue.getActiveSlots(chatJid);
            if (activeSlots.length === 0) {
              await channel.sendMessage(chatJid, 'No active task slots.');
            } else {
              const lines = activeSlots.map(
                (s) =>
                  `• *#${s.slotId}* — ${s.idleWaiting ? 'idle (waiting for input)' : 'busy'}`,
              );
              await channel.sendMessage(
                chatJid,
                `*Active task slots:*\n${lines.join('\n')}`,
              );
            }
            lastAgentTimestamp[chatJid] = latestMsg.timestamp;
            saveState();
            continue;
          }

          if (slotParse.type === 'slot-close' && slotParse.slotId) {
            // #N close — close a slot
            const closed = queue.closeSlot(chatJid, slotParse.slotId);
            if (closed) {
              await channel.sendMessage(
                chatJid,
                `Slot *#${slotParse.slotId}* is shutting down.`,
              );
            } else {
              await channel.sendMessage(
                chatJid,
                `Slot *#${slotParse.slotId}* is not active.`,
              );
              queue.removeSlot(chatJid, slotParse.slotId);
            }
            lastAgentTimestamp[chatJid] = latestMsg.timestamp;
            saveState();
            continue;
          }

          if (slotParse.type === 'slot-message' && slotParse.slotId) {
            // #N message — route to slot container
            const slotId = slotParse.slotId;

            // Pull pending messages and format
            const allPending = getMessagesSince(
              chatJid,
              lastAgentTimestamp[chatJid] || '',
              ASSISTANT_NAME,
            );
            const messagesToSend =
              allPending.length > 0 ? allPending : groupMessages;
            const formatted = formatMessages(messagesToSend, TIMEZONE);

            // Try piping to existing active slot first
            if (queue.sendSlotMessage(chatJid, slotId, formatted)) {
              logger.debug(
                { chatJid, slotId, count: messagesToSend.length },
                'Piped messages to slot container',
              );
              lastAgentTimestamp[chatJid] =
                messagesToSend[messagesToSend.length - 1].timestamp;
              saveState();
              channel
                .setTyping?.(chatJid, true)
                ?.catch((err) =>
                  logger.warn(
                    { chatJid, err },
                    'Failed to set typing indicator',
                  ),
                );
            } else {
              // No active slot container — spawn one
              const routed = queue.routeToSlot(chatJid, slotId);
              if (!routed) {
                await channel.sendMessage(
                  chatJid,
                  `Cannot create slot *#${slotId}* — at capacity. Close an existing slot first with \`#<name> close\`.`,
                );
                lastAgentTimestamp[chatJid] = latestMsg.timestamp;
                saveState();
              }
              // routeToSlot handles cursor advancement via processSlotMessages
            }
            continue;
          }

          // ── Primary container (no slot prefix) ────────────────

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend, TIMEZONE);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            channel
              .setTyping?.(chatJid, true)
              ?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Ensure OneCLI agents exist for all registered groups.
  // Recovers from missed creates (e.g. OneCLI was down at registration time).
  for (const [jid, group] of Object.entries(registeredGroups)) {
    ensureOneCLIAgent(jid, group);
  }

  restoreRemoteControl();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle /remote-control and /remote-control-end commands
  async function handleRemoteControl(
    command: string,
    chatJid: string,
    msg: NewMessage,
  ): Promise<void> {
    const group = registeredGroups[chatJid];
    if (!group?.isMain) {
      logger.warn(
        { chatJid, sender: msg.sender },
        'Remote control rejected: not main group',
      );
      return;
    }

    const channel = findChannel(channels, chatJid);
    if (!channel) return;

    if (command === '/remote-control') {
      const result = await startRemoteControl(
        msg.sender,
        chatJid,
        process.cwd(),
      );
      if (result.ok) {
        await channel.sendMessage(chatJid, result.url);
      } else {
        await channel.sendMessage(
          chatJid,
          `Remote Control failed: ${result.error}`,
        );
      }
    } else {
      const result = stopRemoteControl();
      if (result.ok) {
        await channel.sendMessage(chatJid, 'Remote Control session ended.');
      } else {
        await channel.sendMessage(chatJid, result.error);
      }
    }
  }

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (chatJid: string, msg: NewMessage) => {
      // Remote control commands — intercept before storage
      const trimmed = msg.content.trim();
      if (trimmed === '/remote-control' || trimmed === '/remote-control-end') {
        handleRemoteControl(trimmed, chatJid, msg).catch((err) =>
          logger.error({ err, chatJid }, 'Remote control command error'),
        );
        return;
      }

      // Sender allowlist drop mode: discard messages from denied senders before storing
      if (!msg.is_from_me && !msg.is_bot_message && registeredGroups[chatJid]) {
        const cfg = loadSenderAllowlist();
        if (
          shouldDropMessage(chatJid, cfg) &&
          !isSenderAllowed(chatJid, msg.sender, cfg)
        ) {
          if (cfg.logDenied) {
            logger.debug(
              { chatJid, sender: msg.sender },
              'sender-allowlist: dropping message (drop mode)',
            );
          }
          return;
        }
      }
      storeMessage(msg);
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  // Create and connect all registered channels.
  // Each channel self-registers via the barrel import above.
  // Factories return null when credentials are missing, so unconfigured channels are skipped.
  for (const channelName of getRegisteredChannelNames()) {
    const factory = getChannelFactory(channelName)!;
    const channel = factory(channelOpts);
    if (!channel) {
      logger.warn(
        { channel: channelName },
        'Channel installed but credentials missing — skipping. Check .env or re-run the channel skill.',
      );
      continue;
    }
    channels.push(channel);
    await channel.connect();
  }
  if (channels.length === 0) {
    logger.fatal('No channels connected');
    process.exit(1);
  }

  // Initialize Telegram bot pool for agent swarm support
  if (TELEGRAM_BOT_POOL.length > 0) {
    const { initBotPool } = await import('./channels/telegram.js');
    await initBotPool(TELEGRAM_BOT_POOL);
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'No channel owns JID, cannot send message');
        return;
      }
      const text = formatOutbound(rawText, channel.name as ChannelType);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      const text = formatOutbound(rawText, channel.name as ChannelType);
      if (!text) return Promise.resolve();
      return channel.sendMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroups: async (force: boolean) => {
      await Promise.all(
        channels
          .filter((ch) => ch.syncGroups)
          .map((ch) => ch.syncGroups!(force)),
      );
    },
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
    onTasksChanged: () => {
      const tasks = getAllTasks();
      const taskRows = tasks.map((t) => ({
        id: t.id,
        groupFolder: t.group_folder,
        prompt: t.prompt,
        script: t.script || undefined,
        schedule_type: t.schedule_type,
        schedule_value: t.schedule_value,
        status: t.status,
        next_run: t.next_run,
      }));
      for (const group of Object.values(registeredGroups)) {
        writeTasksSnapshot(group.folder, group.isMain === true, taskRows);
      }
    },
  });
  queue.setProcessMessagesFn(processGroupMessages);
  queue.setOverflowFn(processOverflowMessages);
  queue.setSlotProcessFn(processSlotMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
