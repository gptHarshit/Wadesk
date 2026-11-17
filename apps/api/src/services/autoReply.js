import { db } from '../db.js';
import { redis } from '../redis.js';
import { deliver } from './outbound.js';
import { sendText } from './whatsapp.js';

const PRIORITY = { exact: 0, starts_with: 1, contains: 2 };
const COOLDOWN_SECONDS = 10;

export function matchesRule(rule, text) {
  const keyword = rule.keyword.trim().toLowerCase();
  const value = String(text ?? '').trim().toLowerCase();
  if (!keyword || !value) return false;
  if (rule.matchType === 'exact') return value === keyword;
  if (rule.matchType === 'starts_with') return value.startsWith(keyword);
  return value.includes(keyword);
}

/** Pick the rule to answer with: exact matches win over "starts with", which win over "contains". */
export function pickRule(rules, text) {
  return (
    [...rules]
      .sort((a, b) => PRIORITY[a.matchType] - PRIORITY[b.matchType])
      .find((rule) => matchesRule(rule, text)) ?? null
  );
}

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
