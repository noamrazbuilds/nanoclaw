import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  MAX_CONCURRENT_CONTAINERS,
  MAX_OVERFLOW_PER_GROUP,
  MAX_SLOTS_PER_GROUP,
} from './config.js';
import { logger } from './logger.js';
import { SlotState, slotIpcSubdir } from './slots.js';

interface QueuedTask {
  id: string;
  groupJid: string;
  fn: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;

interface GroupState {
  active: boolean;
  idleWaiting: boolean;
  isTaskContainer: boolean;
  runningTaskId: string | null;
  pendingMessages: boolean;
  pendingTasks: QueuedTask[];
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  retryCount: number;
  overflowCount: number;
  slots: Map<string, SlotState>;
}

export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((groupJid: string) => Promise<boolean>) | null =
    null;
  private shuttingDown = false;

  private getGroup(groupJid: string): GroupState {
    let state = this.groups.get(groupJid);
    if (!state) {
      state = {
        active: false,
        idleWaiting: false,
        isTaskContainer: false,
        runningTaskId: null,
        pendingMessages: false,
        pendingTasks: [],
        process: null,
        containerName: null,
        groupFolder: null,
        retryCount: 0,
        overflowCount: 0,
        slots: new Map(),
      };
      this.groups.set(groupJid, state);
    }
    return state;
  }

  private overflowFn: ((groupJid: string) => Promise<void>) | null = null;

  setProcessMessagesFn(fn: (groupJid: string) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  setOverflowFn(fn: (groupJid: string) => Promise<void>): void {
    this.overflowFn = fn;
  }

  /**
   * Check whether an overflow container should be spawned for this group.
   * True when the primary container is busy (not idle-waiting), overflow cap
   * isn't reached, and global concurrency has room.
   */
  shouldOverflow(groupJid: string): boolean {
    const state = this.getGroup(groupJid);
    return (
      state.active &&
      !state.idleWaiting &&
      !state.isTaskContainer &&
      state.overflowCount < MAX_OVERFLOW_PER_GROUP &&
      this.activeCount < MAX_CONCURRENT_CONTAINERS &&
      this.overflowFn !== null
    );
  }

  /**
   * Spawn an overflow container for a group whose primary is busy.
   * Overflow containers don't own the group slot — they just borrow a
   * global concurrency slot and decrement on completion.
   */
  runOverflow(groupJid: string): void {
    if (this.shuttingDown || !this.overflowFn) return;

    const state = this.getGroup(groupJid);
    state.overflowCount++;
    this.activeCount++;

    logger.info(
      {
        groupJid,
        overflowCount: state.overflowCount,
        activeCount: this.activeCount,
      },
      'Spawning overflow container',
    );

    this.overflowFn(groupJid)
      .catch((err) =>
        logger.error({ groupJid, err }, 'Overflow container error'),
      )
      .finally(() => {
        state.overflowCount--;
        this.activeCount--;
        // Overflow doesn't own the group slot — just free the global slot
        this.drainWaiting();
      });
  }

  // ── Slot management ──────────────────────────────────────────────

  private slotProcessFn:
    | ((groupJid: string, slotId: string) => Promise<void>)
    | null = null;

  setSlotProcessFn(
    fn: (groupJid: string, slotId: string) => Promise<void>,
  ): void {
    this.slotProcessFn = fn;
  }

  /** Get or create slot state for a group */
  getSlot(groupJid: string, slotId: string): SlotState | undefined {
    const state = this.getGroup(groupJid);
    return state.slots.get(slotId);
  }

  /** List all active slots for a group */
  getActiveSlots(groupJid: string): SlotState[] {
    const state = this.getGroup(groupJid);
    return Array.from(state.slots.values()).filter((s) => s.active);
  }

  /** Check whether a new slot can be created for this group */
  canCreateSlot(groupJid: string): boolean {
    const state = this.getGroup(groupJid);
    return (
      state.slots.size < MAX_SLOTS_PER_GROUP &&
      this.activeCount < MAX_CONCURRENT_CONTAINERS &&
      this.slotProcessFn !== null
    );
  }

  /**
   * Route a message to a slot. If the slot exists and has an active container,
   * pipe via IPC. Otherwise spawn a new slot container.
   * Returns true if routed, false if can't (concurrency limit).
   */
  routeToSlot(groupJid: string, slotId: string): boolean {
    if (this.shuttingDown || !this.slotProcessFn) return false;

    const state = this.getGroup(groupJid);
    const slot = state.slots.get(slotId);

    // Existing slot — try to pipe via IPC
    if (slot?.active && slot.groupFolder) {
      slot.idleWaiting = false;
      const inputDir = path.join(
        DATA_DIR,
        'ipc',
        slot.groupFolder,
        slotIpcSubdir(slotId),
      );
      // IPC file will be written by the caller (index.ts) after formatting
      // Just return true to indicate the slot exists and is active
      return true;
    }

    // Need to create/restart the slot — check capacity
    if (!this.canCreateSlot(groupJid) && !slot) {
      logger.warn(
        {
          groupJid,
          slotId,
          slotCount: state.slots.size,
          activeCount: this.activeCount,
        },
        'Cannot create slot: at capacity',
      );
      return false;
    }

    // Create or reactivate slot
    const newSlot: SlotState = slot || {
      slotId,
      active: false,
      idleWaiting: false,
      process: null,
      containerName: null,
      groupFolder: null,
      sessionKey: '',
    };
    if (!slot) state.slots.set(slotId, newSlot);

    newSlot.active = true;
    newSlot.idleWaiting = false;
    this.activeCount++;

    logger.info(
      { groupJid, slotId, activeCount: this.activeCount },
      'Spawning slot container',
    );

    this.slotProcessFn(groupJid, slotId)
      .catch((err) =>
        logger.error({ groupJid, slotId, err }, 'Slot container error'),
      )
      .finally(() => {
        newSlot.active = false;
        newSlot.process = null;
        newSlot.containerName = null;
        this.activeCount--;
        this.drainWaiting();
      });

    return true;
  }

  /** Send a follow-up message to an active slot container via IPC */
  sendSlotMessage(groupJid: string, slotId: string, text: string): boolean {
    const state = this.getGroup(groupJid);
    const slot = state.slots.get(slotId);
    if (!slot?.active || !slot.groupFolder) return false;
    slot.idleWaiting = false;

    const inputDir = path.join(
      DATA_DIR,
      'ipc',
      slot.groupFolder,
      slotIpcSubdir(slotId),
    );
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch {
      return false;
    }
  }

  /** Register a slot container process */
  registerSlotProcess(
    groupJid: string,
    slotId: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder: string,
  ): void {
    const state = this.getGroup(groupJid);
    const slot = state.slots.get(slotId);
    if (slot) {
      slot.process = proc;
      slot.containerName = containerName;
      slot.groupFolder = groupFolder;
    }
  }

  /** Mark a slot container as idle-waiting */
  notifySlotIdle(groupJid: string, slotId: string): void {
    const state = this.getGroup(groupJid);
    const slot = state.slots.get(slotId);
    if (slot) slot.idleWaiting = true;
  }

  /** Close a slot's stdin to wind down the container */
  closeSlot(groupJid: string, slotId: string): boolean {
    const state = this.getGroup(groupJid);
    const slot = state.slots.get(slotId);
    if (!slot?.active || !slot.groupFolder) return false;

    const inputDir = path.join(
      DATA_DIR,
      'ipc',
      slot.groupFolder,
      slotIpcSubdir(slotId),
    );
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
      return true;
    } catch {
      return false;
    }
  }

  /** Remove a slot entirely (after it's been closed) */
  removeSlot(groupJid: string, slotId: string): void {
    const state = this.getGroup(groupJid);
    state.slots.delete(slotId);
  }

  // ── End slot management ─────────────────────────────────────────

  enqueueMessageCheck(groupJid: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    if (state.active) {
      if (this.shouldOverflow(groupJid)) {
        this.runOverflow(groupJid);
        return;
      }
      state.pendingMessages = true;
      logger.debug(
        { groupJid },
        'Container active, overflow unavailable, message queued',
      );
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingMessages = true;
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, activeCount: this.activeCount },
        'At concurrency limit, message queued',
      );
      return;
    }

    this.runForGroup(groupJid, 'messages').catch((err) =>
      logger.error({ groupJid, err }, 'Unhandled error in runForGroup'),
    );
  }

  enqueueTask(groupJid: string, taskId: string, fn: () => Promise<void>): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    // Prevent double-queuing: check both pending and currently-running task
    if (state.runningTaskId === taskId) {
      logger.debug({ groupJid, taskId }, 'Task already running, skipping');
      return;
    }
    if (state.pendingTasks.some((t) => t.id === taskId)) {
      logger.debug({ groupJid, taskId }, 'Task already queued, skipping');
      return;
    }

    if (state.active) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (state.idleWaiting) {
        this.closeStdin(groupJid);
      }
      logger.debug({ groupJid, taskId }, 'Container active, task queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, taskId, activeCount: this.activeCount },
        'At concurrency limit, task queued',
      );
      return;
    }

    // Run immediately
    this.runTask(groupJid, { id: taskId, groupJid, fn }).catch((err) =>
      logger.error({ groupJid, taskId, err }, 'Unhandled error in runTask'),
    );
  }

  registerProcess(
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder?: string,
  ): void {
    const state = this.getGroup(groupJid);
    state.process = proc;
    state.containerName = containerName;
    if (groupFolder) state.groupFolder = groupFolder;
  }

  /**
   * Mark the container as idle-waiting (finished work, waiting for IPC input).
   * If tasks are pending, preempt the idle container immediately.
   */
  notifyIdle(groupJid: string): void {
    const state = this.getGroup(groupJid);
    state.idleWaiting = true;
    if (state.pendingTasks.length > 0) {
      this.closeStdin(groupJid);
    }
  }

  /**
   * Send a follow-up message to the active container via IPC file.
   * Returns true if the message was written, false if no active container.
   */
  sendMessage(groupJid: string, text: string): boolean {
    const state = this.getGroup(groupJid);
    if (!state.active || !state.groupFolder || state.isTaskContainer)
      return false;
    state.idleWaiting = false; // Agent is about to receive work, no longer idle

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signal the active container to wind down by writing a close sentinel.
   */
  closeStdin(groupJid: string): void {
    const state = this.getGroup(groupJid);
    if (!state.active || !state.groupFolder) return;

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
    } catch {
      // ignore
    }
  }

  private async runForGroup(
    groupJid: string,
    reason: 'messages' | 'drain',
  ): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.idleWaiting = false;
    state.isTaskContainer = false;
    state.pendingMessages = false;
    this.activeCount++;

    logger.debug(
      { groupJid, reason, activeCount: this.activeCount },
      'Starting container for group',
    );

    try {
      if (this.processMessagesFn) {
        const success = await this.processMessagesFn(groupJid);
        if (success) {
          state.retryCount = 0;
        } else {
          this.scheduleRetry(groupJid, state);
        }
      }
    } catch (err) {
      logger.error({ groupJid, err }, 'Error processing messages for group');
      this.scheduleRetry(groupJid, state);
    } finally {
      state.active = false;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      this.activeCount--;
      this.drainGroup(groupJid);
    }
  }

  private async runTask(groupJid: string, task: QueuedTask): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.idleWaiting = false;
    state.isTaskContainer = true;
    state.runningTaskId = task.id;
    this.activeCount++;

    logger.debug(
      { groupJid, taskId: task.id, activeCount: this.activeCount },
      'Running queued task',
    );

    try {
      await task.fn();
    } catch (err) {
      logger.error({ groupJid, taskId: task.id, err }, 'Error running task');
    } finally {
      state.active = false;
      state.isTaskContainer = false;
      state.runningTaskId = null;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      this.activeCount--;
      this.drainGroup(groupJid);
    }
  }

  private scheduleRetry(groupJid: string, state: GroupState): void {
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      logger.error(
        { groupJid, retryCount: state.retryCount },
        'Max retries exceeded, dropping messages (will retry on next incoming message)',
      );
      state.retryCount = 0;
      return;
    }

    const delayMs = BASE_RETRY_MS * Math.pow(2, state.retryCount - 1);
    logger.info(
      { groupJid, retryCount: state.retryCount, delayMs },
      'Scheduling retry with backoff',
    );
    setTimeout(() => {
      if (!this.shuttingDown) {
        this.enqueueMessageCheck(groupJid);
      }
    }, delayMs);
  }

  private drainGroup(groupJid: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    // Tasks first (they won't be re-discovered from SQLite like messages)
    if (state.pendingTasks.length > 0) {
      const task = state.pendingTasks.shift()!;
      this.runTask(groupJid, task).catch((err) =>
        logger.error(
          { groupJid, taskId: task.id, err },
          'Unhandled error in runTask (drain)',
        ),
      );
      return;
    }

    // Then pending messages
    if (state.pendingMessages) {
      this.runForGroup(groupJid, 'drain').catch((err) =>
        logger.error(
          { groupJid, err },
          'Unhandled error in runForGroup (drain)',
        ),
      );
      return;
    }

    // Nothing pending for this group; check if other groups are waiting for a slot
    this.drainWaiting();
  }

  private drainWaiting(): void {
    while (
      this.waitingGroups.length > 0 &&
      this.activeCount < MAX_CONCURRENT_CONTAINERS
    ) {
      const nextJid = this.waitingGroups.shift()!;
      const state = this.getGroup(nextJid);

      // Prioritize tasks over messages
      if (state.pendingTasks.length > 0) {
        const task = state.pendingTasks.shift()!;
        this.runTask(nextJid, task).catch((err) =>
          logger.error(
            { groupJid: nextJid, taskId: task.id, err },
            'Unhandled error in runTask (waiting)',
          ),
        );
      } else if (state.pendingMessages) {
        this.runForGroup(nextJid, 'drain').catch((err) =>
          logger.error(
            { groupJid: nextJid, err },
            'Unhandled error in runForGroup (waiting)',
          ),
        );
      }
      // If neither pending, skip this group
    }
  }

  isActive(groupJid: string): boolean {
    return this.getGroup(groupJid).active;
  }

  async shutdown(_gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;

    // Count active containers but don't kill them — they'll finish on their own
    // via idle timeout or container timeout. The --rm flag cleans them up on exit.
    // This prevents WhatsApp reconnection restarts from killing working agents.
    const activeContainers: string[] = [];
    for (const [_jid, state] of this.groups) {
      if (state.process && !state.process.killed && state.containerName) {
        activeContainers.push(state.containerName);
      }
      for (const slot of state.slots.values()) {
        if (slot.process && !slot.process.killed && slot.containerName) {
          activeContainers.push(`slot:${slot.slotId}:${slot.containerName}`);
        }
      }
    }

    logger.info(
      { activeCount: this.activeCount, detachedContainers: activeContainers },
      'GroupQueue shutting down (containers detached, not killed)',
    );
  }
}
