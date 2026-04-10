import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import {
  DATA_DIR,
  IPC_POLL_INTERVAL,
  TIMEZONE,
  TELEGRAM_BOT_POOL,
} from './config.js';
import { sendPoolMessage } from './channels/telegram.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { isValidGroupFolder } from './group-folder.js';
import { executeHostOp, isValidHostOp } from './host-ops.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  sendAudio?: (
    jid: string,
    audioPath: string,
    caption?: string,
  ) => Promise<void>;
  sendDocument?: (
    jid: string,
    filePath: string,
    caption?: string,
    filename?: string,
  ) => Promise<void>;
  sendReaction?: (
    jid: string,
    emoji: string,
    messageId?: string,
  ) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroups: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  onTasksChanged: () => void;
  statusHeartbeat?: () => void;
  recoverPendingMessages?: () => void;
}

// --- IPC Rate Limiting ---
// Prevents a compromised agent from spamming messages or scheduling tasks

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimits: Record<string, Record<string, RateBucket>> = {};

const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  message: { max: 20, windowMs: 60_000 }, // 20 messages per minute per group
  schedule_task: { max: 5, windowMs: 3_600_000 }, // 5 tasks per hour per group
  host_op: { max: 3, windowMs: 3_600_000 }, // 3 host ops per hour
  register_group: { max: 5, windowMs: 3_600_000 }, // 5 registrations per hour
};

/** Reset all rate limit buckets (for testing) */
export function resetRateLimits(): void {
  for (const key of Object.keys(rateLimits)) {
    delete rateLimits[key];
  }
}

function checkRateLimit(group: string, operation: string): boolean {
  const limit = RATE_LIMITS[operation];
  if (!limit) return true;

  const key = `${group}:${operation}`;
  if (!rateLimits[group]) rateLimits[group] = {};

  const now = Date.now();
  let bucket = rateLimits[group][operation];

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + limit.windowMs };
    rateLimits[group][operation] = bucket;
  }

  bucket.count++;
  return bucket.count <= limit.max;
}

let ipcWatcherRunning = false;
const RECOVERY_INTERVAL_MS = 60_000;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });
  let lastRecoveryTime = Date.now();

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    // Build folder→isMain lookup from registered groups
    const folderIsMain = new Map<string, boolean>();
    for (const group of Object.values(registeredGroups)) {
      if (group.isMain) folderIsMain.set(group.folder, true);
    }

    for (const sourceGroup of groupFolders) {
      const isMain = folderIsMain.get(sourceGroup) === true;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'audio' && data.chatJid && data.filePath) {
                // Translate container paths to host paths.
                // Inside the container, /workspace/group/ maps to groups/{sourceGroup}/
                let audioPath: string = data.filePath;
                if (audioPath.startsWith('/workspace/group/')) {
                  audioPath = audioPath.replace(
                    '/workspace/group/',
                    `groups/${sourceGroup}/`,
                  );
                }
                // Verify the audio file exists and is non-empty before sending
                if (!fs.existsSync(audioPath)) {
                  logger.error(
                    { audioPath, sourceGroup, originalPath: data.filePath },
                    'IPC audio file not found — skill may have failed or used wrong path',
                  );
                } else if (fs.statSync(audioPath).size < 100) {
                  logger.error(
                    {
                      audioPath,
                      size: fs.statSync(audioPath).size,
                      sourceGroup,
                    },
                    'IPC audio file is suspiciously small — skill may have produced invalid output',
                  );
                }

                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  if (deps.sendAudio) {
                    await deps.sendAudio(data.chatJid, audioPath, data.caption);
                    logger.info(
                      { chatJid: data.chatJid, sourceGroup, audioPath },
                      'IPC audio sent',
                    );
                  } else {
                    logger.warn(
                      { chatJid: data.chatJid },
                      'Audio IPC received but no sendAudio handler',
                    );
                  }
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC audio attempt blocked',
                  );
                }
              } else if (
                data.type === 'document' &&
                data.chatJid &&
                data.filePath
              ) {
                // Translate container paths to host paths
                let docPath: string = data.filePath;
                if (docPath.startsWith('/workspace/group/')) {
                  docPath = docPath.replace(
                    '/workspace/group/',
                    `groups/${sourceGroup}/`,
                  );
                }
                // Verify the document file exists and is non-empty
                if (!fs.existsSync(docPath)) {
                  logger.error(
                    {
                      docPath,
                      sourceGroup,
                      originalPath: data.filePath,
                    },
                    'IPC document file not found — skill may have failed or used wrong path',
                  );
                } else if (fs.statSync(docPath).size < 1) {
                  logger.error(
                    {
                      docPath,
                      size: fs.statSync(docPath).size,
                      sourceGroup,
                    },
                    'IPC document file is empty',
                  );
                } else {
                  const targetGroup = registeredGroups[data.chatJid];
                  if (
                    isMain ||
                    (targetGroup && targetGroup.folder === sourceGroup)
                  ) {
                    if (deps.sendDocument) {
                      try {
                        await deps.sendDocument(
                          data.chatJid,
                          docPath,
                          data.caption,
                          data.filename,
                        );
                        logger.info(
                          { chatJid: data.chatJid, sourceGroup, docPath },
                          'IPC document sent',
                        );
                      } catch (docErr) {
                        logger.error(
                          {
                            chatJid: data.chatJid,
                            sourceGroup,
                            docPath,
                            err: docErr,
                          },
                          'IPC document send failed',
                        );
                      }
                    } else {
                      logger.warn(
                        { chatJid: data.chatJid },
                        'Document IPC received but no sendDocument handler',
                      );
                    }
                  } else {
                    logger.warn(
                      { chatJid: data.chatJid, sourceGroup },
                      'Unauthorized IPC document attempt blocked',
                    );
                  }
                }
              } else if (data.type === 'message' && data.chatJid && data.text) {
                // Rate limit check
                if (!checkRateLimit(sourceGroup, 'message')) {
                  logger.warn(
                    { sourceGroup, chatJid: data.chatJid },
                    'IPC message rate limited',
                  );
                  fs.unlinkSync(filePath);
                  continue;
                }
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  if (
                    data.sender &&
                    data.chatJid.startsWith('tg:') &&
                    TELEGRAM_BOT_POOL.length > 0
                  ) {
                    await sendPoolMessage(
                      data.chatJid,
                      data.text,
                      data.sender,
                      sourceGroup,
                    );
                  } else {
                    await deps.sendMessage(data.chatJid, data.text);
                  }
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup, sender: data.sender },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              } else if (
                data.type === 'reaction' &&
                data.chatJid &&
                data.emoji &&
                deps.sendReaction
              ) {
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  try {
                    await deps.sendReaction(
                      data.chatJid,
                      data.emoji,
                      data.messageId,
                    );
                    logger.info(
                      { chatJid: data.chatJid, emoji: data.emoji, sourceGroup },
                      'IPC reaction sent',
                    );
                  } catch (err) {
                    logger.error(
                      {
                        chatJid: data.chatJid,
                        emoji: data.emoji,
                        sourceGroup,
                        err,
                      },
                      'IPC reaction failed',
                    );
                  }
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC reaction attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain, deps);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    // Status emoji heartbeat — detect dead containers with stale emoji state
    deps.statusHeartbeat?.();

    // Periodic message recovery — catch stuck messages after retry exhaustion or pipeline stalls
    const now = Date.now();
    if (now - lastRecoveryTime >= RECOVERY_INTERVAL_MS) {
      lastRecoveryTime = now;
      deps.recoverPendingMessages?.();
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    model?: string;
    script?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
    // For host_op
    op?: string;
    args?: Record<string, unknown>;
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        // Rate limit check
        if (!checkRateLimit(sourceGroup, 'schedule_task')) {
          logger.warn({ sourceGroup }, 'schedule_task rate limited');
          break;
        }
        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-main groups can only schedule for themselves
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          let date = new Date(data.schedule_value);
          // If the value has no timezone indicator, interpret it in the
          // configured timezone (e.g. Asia/Jerusalem) rather than UTC.
          if (
            !/[Zz]/.test(data.schedule_value) &&
            !/[+-]\d{2}:?\d{2}$/.test(data.schedule_value)
          ) {
            const localStr = new Date(
              date.toLocaleString('en-US', { timeZone: TIMEZONE }),
            ).getTime();
            const utcStr = date.getTime();
            date = new Date(utcStr + (utcStr - localStr));
          }
          if (isNaN(date.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = date.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          script: data.script || null,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          model: data.model || null,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
        deps.onTasksChanged();
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
          deps.onTasksChanged();
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
          deps.onTasksChanged();
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
          deps.onTasksChanged();
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'update_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (!task) {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Task not found for update',
          );
          break;
        }
        if (!isMain && task.group_folder !== sourceGroup) {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task update attempt',
          );
          break;
        }

        const updates: Parameters<typeof updateTask>[1] = {};
        if (data.prompt !== undefined) updates.prompt = data.prompt;
        if (data.script !== undefined) updates.script = data.script || null;
        if (data.schedule_type !== undefined)
          updates.schedule_type = data.schedule_type as
            | 'cron'
            | 'interval'
            | 'once';
        if (data.schedule_value !== undefined)
          updates.schedule_value = data.schedule_value;
        if (data.model !== undefined) updates.model = data.model || null;

        // Recompute next_run if schedule changed
        if (data.schedule_type || data.schedule_value) {
          const updatedTask = {
            ...task,
            ...updates,
          };
          if (updatedTask.schedule_type === 'cron') {
            try {
              const interval = CronExpressionParser.parse(
                updatedTask.schedule_value,
                { tz: TIMEZONE },
              );
              updates.next_run = interval.next().toISOString();
            } catch {
              logger.warn(
                { taskId: data.taskId, value: updatedTask.schedule_value },
                'Invalid cron in task update',
              );
              break;
            }
          } else if (updatedTask.schedule_type === 'interval') {
            const ms = parseInt(updatedTask.schedule_value, 10);
            if (!isNaN(ms) && ms > 0) {
              updates.next_run = new Date(Date.now() + ms).toISOString();
            }
          }
        }

        updateTask(data.taskId, updates);
        logger.info(
          { taskId: data.taskId, sourceGroup, updates },
          'Task updated via IPC',
        );
        deps.onTasksChanged();
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroups(true);
        // Write updated snapshot immediately
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Rate limit check
      if (!checkRateLimit(sourceGroup, 'register_group')) {
        logger.warn({ sourceGroup }, 'register_group rate limited');
        break;
      }
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!isValidGroupFolder(data.folder)) {
          logger.warn(
            { sourceGroup, folder: data.folder },
            'Invalid register_group request - unsafe folder name',
          );
          break;
        }
        // Defense in depth: agent cannot set isMain via IPC
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'host_op':
      // Only main group can trigger host operations
      if (!isMain) {
        logger.warn(
          { sourceGroup, op: data.op },
          'Unauthorized host_op attempt blocked',
        );
        break;
      }
      // Rate limit check
      if (!checkRateLimit(sourceGroup, 'host_op')) {
        logger.warn({ sourceGroup, op: data.op }, 'host_op rate limited');
        break;
      }
      if (data.op && isValidHostOp(data.op)) {
        const result = await executeHostOp(data.op, data.args);
        // Send result back to the requesting chat
        const sourceJid = Object.entries(registeredGroups).find(
          ([, g]) => g.folder === sourceGroup,
        )?.[0];
        if (sourceJid) {
          const status = result.ok ? '✅' : '❌';
          await deps.sendMessage(
            sourceJid,
            `${status} host_op \`${data.op}\`: ${result.message}`,
          );
        }
        logger.info(
          { op: data.op, ok: result.ok, sourceGroup },
          'Host operation completed via IPC',
        );
      } else {
        logger.warn(
          { op: data.op, sourceGroup },
          'Invalid host_op: unknown operation',
        );
      }
      break;

    case 'update_group_config':
      // Only main group can update other groups' containerConfig
      if (!isMain) {
        logger.warn(
          { sourceGroup, jid: data.jid },
          'Unauthorized update_group_config attempt blocked',
        );
        break;
      }
      if (data.jid && data.containerConfig !== undefined) {
        const existing = registeredGroups[data.jid];
        if (!existing) {
          logger.warn(
            { jid: data.jid },
            'update_group_config: group not registered',
          );
          break;
        }
        const updated: RegisteredGroup = {
          ...existing,
          containerConfig: {
            ...existing.containerConfig,
            ...data.containerConfig,
          },
        };
        deps.registerGroup(data.jid, updated);
        logger.info(
          { jid: data.jid, containerConfig: data.containerConfig },
          'Group containerConfig updated via IPC',
        );
      } else {
        logger.warn(
          { data },
          'update_group_config: missing jid or containerConfig',
        );
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}
