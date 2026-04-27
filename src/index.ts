import fs from 'fs';
import path from 'path';

import { OneCLI } from '@onecli-sh/sdk';

import {
  ASSISTANT_NAME,
  CLAUDE_OAUTH_TOKEN,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TRIGGER,
  getTriggerPattern,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  LITELLM_PROXY_URL,
  ONECLI_URL,
  POLL_INTERVAL,
  TELEGRAM_BOT_POOL,
  TIMEZONE,
  USE_OAUTH,
} from './config.js';
import './channels/index.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import {
  computeSkillsHash,
  ContainerOutput,
  MAX_SESSION_AGE_MS,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
} from './container-runtime.js';
import {
  deleteSession,
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessageFromMe,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  getSessionRow,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import {
  findChannel,
  formatMessages,
  formatOutbound,
  routeAudio,
  routeDocument,
} from './router.js';
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
import { StatusTracker } from './status-tracker.js';
import { logger } from './logger.js';
import {
  isAuthError,
  isCreditError,
  startOAuthRefreshMonitor,
  stopOAuthRefreshMonitor,
} from './oauth-refresh.js';
import { parseSlotPrefix, slotSessionKey } from './slots.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
// Tracks cursor value before messages were piped to an active container.
// Used to roll back if the container dies after piping.
let cursorBeforePipe: Record<string, string> = {};
let messageLoopRunning = false;

const channels: Channel[] = [];
const queue = new GroupQueue();
let statusTracker: StatusTracker;

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
  const pipeCursor = getRouterState('cursor_before_pipe');
  try {
    cursorBeforePipe = pipeCursor ? JSON.parse(pipeCursor) : {};
  } catch {
    logger.warn('Corrupted cursor_before_pipe in DB, resetting');
    cursorBeforePipe = {};
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
  setRouterState('cursor_before_pipe', JSON.stringify(cursorBeforePipe));
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
// When LiteLLM is configured, accept any model name (e.g., /model gpt-4o, /model gemini-2.0-flash)
// Otherwise only accept Anthropic aliases (opus/sonnet/haiku)
const MODEL_SLUG = LITELLM_PROXY_URL
  ? '[a-zA-Z0-9][a-zA-Z0-9._-]*'
  : 'opus|sonnet|haiku';
const MODEL_SLASH_RE = new RegExp(`\\/model\\s+(${MODEL_SLUG})\\b`, 'i');
const DELEGATE_SLASH_RE = /\/delegate-models\b/i;

// Natural language patterns for model selection
// Matches: "use opus", "switch to haiku", "respond with sonnet", "answer in opus"
// Note: NL matching uses ANTHROPIC_ALIASES only (not the permissive MODEL_SLUG)
// to avoid false positives on common English phrases like "in the" → model="the"
const NL_MODEL_SLUG =
  'opus|sonnet|haiku|gpt-4o|gpt-4o-mini|o3|gemini-2\\.5-pro|gemini-2\\.5-flash|gemini-flash-lite|deepseek-v3\\.2|minimax-m2\\.5|kimi-k2\\.5|local-coder|local-general';
const MODEL_NL_RE = new RegExp(
  `\\b(?:use|switch\\s+to|respond\\s+(?:with|in|using)|answer\\s+(?:with|in|using)|run\\s+(?:with|in|on))\\s+(${NL_MODEL_SLUG})\\b`,
  'i',
);

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

  // Ensure all user messages are tracked — recovery messages enter processGroupMessages
  // directly via the queue, bypassing startMessageLoop where markReceived normally fires.
  // markReceived is idempotent (rejects duplicates), so this is safe for normal-path messages too.
  for (const msg of missedMessages) {
    statusTracker.markReceived(msg.id, chatJid, false);
  }

  // Mark all user messages as thinking (container is spawning)
  const userMessages = missedMessages.filter(
    (m) => !m.is_from_me && !m.is_bot_message,
  );
  for (const msg of userMessages) {
    statusTracker.markThinking(msg.id);
  }

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
  let firstOutputSeen = false;

  const output = await runAgent(
    group,
    prompt,
    chatJid,
    imageAttachments,
    directives,
    async (result) => {
      // Streaming output callback — called for each agent result
      if (result.result) {
        if (!firstOutputSeen) {
          firstOutputSeen = true;
          for (const um of userMessages) {
            statusTracker.markWorking(um.id);
          }
        }
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
        statusTracker.markAllDone(chatJid);
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
    if (outputSentToUser) {
      // Output was sent for the initial batch, so don't roll those back.
      // But if messages were piped AFTER that output, roll back to recover them.
      if (cursorBeforePipe[chatJid]) {
        lastAgentTimestamp[chatJid] = cursorBeforePipe[chatJid];
        delete cursorBeforePipe[chatJid];
        saveState();
        logger.warn(
          { group: group.name },
          'Agent error after output, rolled back piped messages for retry',
        );
        statusTracker.markAllFailed(chatJid, 'Task crashed — retrying.');
        return false;
      }
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, no piped messages to recover',
      );
      statusTracker.markAllDone(chatJid);
      return true;
    }
    // No output sent — roll back everything so the full batch is retried
    lastAgentTimestamp[chatJid] = previousCursor;
    delete cursorBeforePipe[chatJid];
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    statusTracker.markAllFailed(chatJid, 'Task crashed — retrying.');
    return false;
  }

  // Success — clear pipe tracking (markAllDone already fired in streaming callback)
  delete cursorBeforePipe[chatJid];
  saveState();
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

  // Session invalidation: clear stale or outdated sessions
  let sessionId: string | undefined = sessions[sessKey];
  if (sessionId) {
    const row = getSessionRow(sessKey);
    let invalidReason = '';

    // Check session age (max 24h)
    if (row?.created_at) {
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (ageMs > MAX_SESSION_AGE_MS) {
        invalidReason = `session expired (age: ${Math.round(ageMs / 3600000)}h)`;
      }
    }

    // Check if skills have changed since session was created
    if (!invalidReason && row?.skills_hash) {
      const currentHash = computeSkillsHash();
      if (currentHash !== row.skills_hash) {
        invalidReason = 'skills changed since session started';
      }
    }

    if (invalidReason) {
      logger.info(
        { group: group.name, sessKey, sessionId, reason: invalidReason },
        'Invalidating session',
      );
      deleteSession(sessKey);
      delete sessions[sessKey];
      sessionId = undefined;
    }
  }

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
          setSession(sessKey, result.newSessionId, computeSkillsHash());
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
      setSession(sessKey, output.newSessionId, computeSkillsHash());
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
  let streamedError: string | undefined;
  let creditErrorInResult = false;
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (!isOverflow && output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId, computeSkillsHash());
        }
        // Capture streamed error text for credit error detection (exit-code-1 path).
        if (output.status === 'error' && output.error) {
          streamedError = output.error;
        }
        // Detect credit errors in the result text (exit-code-0 path: SDK returns
        // the API error as a successful text result rather than throwing).
        // Swallow the message so the user only sees the retry notification,
        // and write the IPC close sentinel so the container exits promptly
        // instead of sitting idle waiting for the next message.
        if (
          output.result &&
          typeof output.result === 'string' &&
          isCreditError(output.result) &&
          directives.model !== 'gpt-4o'
        ) {
          creditErrorInResult = true;
          try {
            const ipcInputDir = path.join(
              resolveGroupIpcPath(group.folder),
              'input',
            );
            fs.mkdirSync(ipcInputDir, { recursive: true });
            fs.writeFileSync(path.join(ipcInputDir, '_close'), '');
          } catch {
            // best-effort; container will exit via idle timeout if this fails
          }
          return;
        }
        await onOutput(output);
      }
    : undefined;

  try {
    // Resolve model: message directive > per-group config > global default
    const resolvedModel =
      directives.model || group.containerConfig?.model || DEFAULT_MODEL;
    // Suppress fallback model for non-Anthropic runs so the SDK can't
    // bounce back to a Claude model (e.g. during credit error retries).
    const resolvedFallback =
      directives.model && directives.model !== DEFAULT_MODEL
        ? undefined
        : group.containerConfig?.fallbackModel || DEFAULT_FALLBACK_MODEL;
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
      setSession(group.folder, output.newSessionId, computeSkillsHash());
    }

    // Credit error check runs regardless of exit status — the SDK may return the
    // Anthropic credit error as a successful text result (exit 0) or as a thrown
    // exception (exit 1). Both paths are covered here.
    const creditErrorText = `${output.error || ''} ${streamedError || ''}`;
    if (
      (isCreditError(creditErrorText) || creditErrorInResult) &&
      directives.model !== 'gpt-4o'
    ) {
      logger.warn(
        { group: group.name },
        'Credit balance too low, retrying with DeepSeek',
      );
      const ch = findChannel(channels, chatJid);
      if (ch) {
        ch.sendMessage(
          chatJid,
          `Hey man, Anthropic credit balance ran dry. No worries — I'm re-running that on GPT-4o. Should be right back.`,
        ).catch(() => {});
      }
      return runAgent(
        group,
        prompt,
        chatJid,
        imageAttachments,
        // gpt-4o: no Claude session format issues, no reasoning_content conflicts.
        // delegateModels cleared to avoid SDK-level fallback back to an Anthropic model.
        { model: 'gpt-4o', delegateModels: false },
        onOutput,
        { isOverflow: true },
      );
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      // Detect OAuth token expiry errors and notify the user
      if (output.error && isAuthError(output.error) && CLAUDE_OAUTH_TOKEN) {
        const ch = findChannel(channels, chatJid);
        if (ch) {
          ch.sendMessage(
            chatJid,
            `⚠️ *Authentication Error*\n\nThe Claude Max OAuth token appears to be expired or invalid. ` +
              `NanoClaw will try to auto-refresh, but if this keeps happening, re-authenticate:\n` +
              `1. SSH into the server\n` +
              `2. Run: \`claude login\`\n` +
              `3. Then: \`cd ~/NanoClaw && python3 -c "import json; d=json.load(open('/home/nanoclaw/.claude/.credentials.json')); o=d['claudeAiOauth'] if isinstance(d['claudeAiOauth'],dict) else json.loads(d['claudeAiOauth']); print(o['accessToken'])" | xargs -I{} sed -i 's/^CLAUDE_OAUTH_TOKEN=.*/CLAUDE_OAUTH_TOKEN={}/' .env\`\n` +
              `4. Restart: \`systemctl --user restart nanoclaw\``,
          ).catch(() => {});
        }
      }
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

          // Mark each user message as received (status emoji)
          for (const msg of groupMessages) {
            if (!msg.is_from_me && !msg.is_bot_message) {
              statusTracker.markReceived(msg.id, chatJid, false);
            }
          }

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
            // Mark new user messages as thinking (only groupMessages were markReceived'd;
            // accumulated allPending context messages are untracked and would no-op)
            for (const msg of groupMessages) {
              if (!msg.is_from_me && !msg.is_bot_message) {
                statusTracker.markThinking(msg.id);
              }
            }
            // Save cursor before first pipe so we can roll back if container dies
            if (!cursorBeforePipe[chatJid]) {
              cursorBeforePipe[chatJid] = lastAgentTimestamp[chatJid] || '';
            }
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
  // Roll back any piped-message cursors that were persisted before a crash.
  // This ensures messages piped to a now-dead container are re-fetched.
  // IMPORTANT: Only roll back if the container is no longer running — rolling
  // back while the container is alive causes duplicate processing.
  let rolledBack = false;
  for (const [chatJid, savedCursor] of Object.entries(cursorBeforePipe)) {
    if (queue.isActive(chatJid)) {
      logger.debug(
        { chatJid },
        'Recovery: skipping piped-cursor rollback, container still active',
      );
      continue;
    }
    logger.info(
      { chatJid, rolledBackTo: savedCursor },
      'Recovery: rolling back piped-message cursor',
    );
    lastAgentTimestamp[chatJid] = savedCursor;
    delete cursorBeforePipe[chatJid];
    rolledBack = true;
  }
  if (rolledBack) {
    saveState();
  }

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
    stopOAuthRefreshMonitor();
    const { arenaOrchestrator: arena } = await import('./arena/index.js');
    await arena.stop();
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    await statusTracker.shutdown();
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

  // Initialize status tracker (uses channels via callbacks, channels don't need to be connected yet)
  statusTracker = new StatusTracker({
    sendReaction: async (chatJid, messageKey, emoji) => {
      const channel = findChannel(channels, chatJid);
      if (!channel?.sendReaction) return;
      await channel.sendReaction(chatJid, messageKey, emoji);
    },
    sendMessage: async (chatJid, text) => {
      const channel = findChannel(channels, chatJid);
      if (!channel) return;
      await channel.sendMessage(chatJid, text);
    },
    isMainGroup: (chatJid) => {
      const group = registeredGroups[chatJid];
      return group?.isMain === true;
    },
    isContainerAlive: (chatJid) => queue.isActive(chatJid),
  });

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

  // Start Model Arena (independent of channel system — polls Telegram directly)
  const { arenaOrchestrator } = await import('./arena/index.js');
  await arenaOrchestrator.start();

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
    sendAudio: (jid, audioPath, caption) =>
      routeAudio(channels, jid, audioPath, caption),
    sendDocument: (jid, filePath, caption, filename) =>
      routeDocument(channels, jid, filePath, caption, filename),
    sendImage: async (jid, imagePath, caption) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      if (!channel.sendImage)
        throw new Error(`Channel ${channel.name} does not support sendImage`);
      return channel.sendImage(jid, imagePath, caption);
    },
    sendReaction: async (jid, emoji, messageId) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      if (messageId) {
        if (!channel.sendReaction)
          throw new Error('Channel does not support sendReaction');
        const messageKey = {
          id: messageId,
          remoteJid: jid,
          fromMe: getMessageFromMe(messageId, jid),
        };
        await channel.sendReaction(jid, messageKey, emoji);
      } else {
        if (!channel.reactToLatestMessage)
          throw new Error('Channel does not support reactions');
        await channel.reactToLatestMessage(jid, emoji);
      }
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
    statusHeartbeat: () => statusTracker.heartbeatCheck(),
    recoverPendingMessages,
  });
  // Recover status tracker AFTER channels connect, so recovery reactions
  // can actually be sent via the WhatsApp channel.
  await statusTracker.recover();
  queue.setProcessMessagesFn(processGroupMessages);
  queue.setOverflowFn(processOverflowMessages);
  queue.setSlotProcessFn(processSlotMessages);

  // Start OAuth token refresh monitor — sends notifications to all main groups
  // if the Max subscription token is about to expire and can't be refreshed.
  // Only active when USE_OAUTH=true (disabled by default per Anthropic policy April 2026).
  if (USE_OAUTH && CLAUDE_OAUTH_TOKEN) {
    startOAuthRefreshMonitor(async (message) => {
      for (const [jid, group] of Object.entries(registeredGroups)) {
        if (!group.isMain) continue;
        const ch = findChannel(channels, jid);
        if (ch) await ch.sendMessage(jid, message);
      }
    });
  }

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
