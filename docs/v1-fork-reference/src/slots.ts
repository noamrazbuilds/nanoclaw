/**
 * Task Slots — allow multiple independent, long-running agent sessions per group.
 *
 * Syntax:
 *   #1 do something          → slot "1"
 *   #research do something   → slot "research"
 *   #my-task do something    → slot "my-task"
 *   #slots                   → list active slots (handled by orchestrator)
 *   #1 close                 → close slot 1
 *
 * Messages without a # prefix go to the primary container as usual.
 */

import { ChildProcess } from 'child_process';

/** Regex to parse slot prefix from a message */
const SLOT_PREFIX_RE = /^#([a-zA-Z0-9][\w-]{0,31})\s+/;

/** Special slot commands (no message body needed) */
const SLOT_LIST_RE = /^#slots?\s*$/i;
const SLOT_CLOSE_RE = /^#([a-zA-Z0-9][\w-]{0,31})\s+close\s*$/i;

export interface SlotParseResult {
  type: 'slot-message' | 'slot-list' | 'slot-close' | 'primary';
  slotId?: string;
  body?: string; // message with prefix stripped
}

/**
 * Parse a message for slot routing.
 * Returns the slot ID and stripped message body, or 'primary' for unslotted messages.
 */
export function parseSlotPrefix(text: string): SlotParseResult {
  const trimmed = text.trim();

  // #slots — list active slots
  if (SLOT_LIST_RE.test(trimmed)) {
    return { type: 'slot-list' };
  }

  // #N close — close a specific slot
  const closeMatch = trimmed.match(SLOT_CLOSE_RE);
  if (closeMatch) {
    return { type: 'slot-close', slotId: closeMatch[1].toLowerCase() };
  }

  // #N message — route to slot
  const slotMatch = trimmed.match(SLOT_PREFIX_RE);
  if (slotMatch) {
    const slotId = slotMatch[1].toLowerCase();
    const body = trimmed.slice(slotMatch[0].length).trim();
    if (body) {
      return { type: 'slot-message', slotId, body };
    }
  }

  // No prefix — primary container
  return { type: 'primary' };
}

/** State of a single slot container */
export interface SlotState {
  slotId: string;
  active: boolean;
  idleWaiting: boolean;
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  /** Separate session key for this slot (group.folder + '/slots/' + slotId) */
  sessionKey: string;
}

/**
 * Build the session key for a slot.
 * This is used as the key in the sessions map and for the session directory.
 */
export function slotSessionKey(groupFolder: string, slotId: string): string {
  return `${groupFolder}/slots/${slotId}`;
}

/**
 * Build the IPC input directory path for a slot.
 * Each slot gets its own IPC input dir to avoid message routing conflicts.
 */
export function slotIpcSubdir(slotId: string): string {
  return `slots/${slotId}/input`;
}
