import { db } from '../db.js';
import { redis } from '../redis.js';
import { deliver } from './outbound.js';
import { pickRule } from './keywords.js';
import { DEFAULT_DAYS, DEFAULT_TIMEZONE, isOpenAt, isValidTimezone } from './officeHours.js';
import { sendText } from './whatsapp.js';

const COOLDOWN_SECONDS = 10;

/** Reply automatically when an incoming text matches an active keyword rule. */
export async function maybeAutoReply({ workspaceId, conversationId, contact, text }) {
  const rules = await db.many(
    `SELECT id, keyword, match_type, reply_text FROM auto_replies
      WHERE workspace_id = $1 AND is_active ORDER BY created_at`,
    [workspaceId],
  );
  const rule = pickRule(rules, text);
  if (!rule) return null;

  // Don't answer the same rule twice in quick succession (e.g. a customer sending "hi" three times).
  const fresh = await redis.set(`wadesk:autoreply:${conversationId}:${rule.id}`, '1', 'EX', COOLDOWN_SECONDS, 'NX');
  if (!fresh) return null;

  return deliver({
    workspaceId,
    conversationId,
    contact,
    source: 'auto_reply',
    type: 'text',
    body: rule.replyText,
    send: (account) => sendText(account, contact, rule.replyText),
  });
}

// One away message per chat in this window, however many messages the customer sends at night.
const AWAY_COOLDOWN_SECONDS = 12 * 60 * 60;

/** Send the away message when someone writes outside office hours. */
export async function maybeAwayReply({ workspaceId, conversationId, contact, at = new Date() }) {
  if (contact?.optedOut) return null;
  const workspace = await db.one(
    'SELECT away_enabled, away_message, office_hours, timezone FROM workspaces WHERE id = $1',
    [workspaceId],
  );
  const message = workspace?.awayMessage?.trim();
  if (!workspace?.awayEnabled || !message) return null;
  const timeZone = isValidTimezone(workspace.timezone) ? workspace.timezone : DEFAULT_TIMEZONE;
  if (isOpenAt(workspace.officeHours ?? DEFAULT_DAYS, at, timeZone)) return null;

  const fresh = await redis.set(`wadesk:away:${conversationId}`, '1', 'EX', AWAY_COOLDOWN_SECONDS, 'NX');
  if (!fresh) return null;

  return deliver({
    workspaceId,
    conversationId,
    contact,
    source: 'auto_reply',
    type: 'text',
    body: message,
    send: (account) => sendText(account, contact, message),
  });
}

export { matchesRule, pickRule, splitKeywords, tidyKeywords } from './keywords.js';
