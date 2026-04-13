/**
 * Arena message router — classifies incoming Telegram updates
 * into broadcast, targeted, or reply-to routing types.
 */

import type { ArenaBotConfig, RoutingType } from './types.js';
import { logger } from '../logger.js';

export interface RoutingResult {
  type: RoutingType;
  targetBotIds: string[];
  /** If reply-to, the telegram_message_id being replied to. */
  replyToMessageId?: number;
}

/**
 * Determine how to route an incoming message.
 * @param message The Telegram message object
 * @param bots Map of bot configs by their Telegram user ID
 * @param botsByUsername Map of bot configs by their @username (lowercase)
 */
export function classifyMessage(
  message: {
    text?: string;
    reply_to_message?: { from?: { id: number }; message_id: number };
    entities?: Array<{ type: string; offset: number; length: number }>;
  },
  bots: Map<number, ArenaBotConfig>,
  botsByUsername: Map<string, ArenaBotConfig>,
): RoutingResult {
  // 1. Reply-to: user replies to a specific bot's message
  if (message.reply_to_message?.from?.id) {
    const targetBot = bots.get(message.reply_to_message.from.id);
    if (targetBot) {
      logger.debug(
        { botId: targetBot.id, replyTo: message.reply_to_message.message_id },
        'Arena reply-to routing',
      );
      return {
        type: 'reply-to',
        targetBotIds: [targetBot.id],
        replyToMessageId: message.reply_to_message.message_id,
      };
    }
  }

  // 2. Targeted: @mention specific bots
  if (message.text && message.entities) {
    const mentions: string[] = [];
    for (const entity of message.entities) {
      if (entity.type === 'mention') {
        const mention = message.text
          .substring(entity.offset, entity.offset + entity.length)
          .replace(/^@/, '')
          .toLowerCase();
        mentions.push(mention);
      }
    }

    if (mentions.length > 0) {
      const targetBotIds: string[] = [];
      for (const mention of mentions) {
        const bot = botsByUsername.get(mention);
        if (bot) targetBotIds.push(bot.id);
      }

      if (targetBotIds.length > 0) {
        logger.debug({ targetBotIds, mentions }, 'Arena targeted routing');
        return { type: 'targeted', targetBotIds };
      }
    }
  }

  // 3. Broadcast: no specific target → all bots
  return { type: 'broadcast', targetBotIds: [] };
}

/** Extract the rating from a Telegram reaction update. */
export function extractRating(
  newReaction: Array<{ type: string; emoji?: string }> | undefined,
): number {
  if (!newReaction) return 0;
  if (newReaction.some((r) => r.emoji === '👍')) return 1;
  if (newReaction.some((r) => r.emoji === '👎')) return -1;
  return 0;
}
