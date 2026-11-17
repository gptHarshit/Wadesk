import { db } from '../db.js';

const CURSOR_TS = (column) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export const CONVERSATION_SELECT = `
  SELECT c.id, c.status, c.assigned_to, c.unread_count, c.last_message_at, c.last_message_preview,
         c.last_message_direction, c.last_inbound_at, c.created_at,
         ${CURSOR_TS('c.last_message_at')} AS cursor_ts,
         json_build_object('id', ct.id, 'name', ct.name, 'phone', ct.phone,
                           'waUsername', ct.wa_username, 'optedOut', ct.opted_out) AS contact,
         CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'name', u.name) END AS assignee
    FROM conversations c
    JOIN contacts ct ON ct.id = c.contact_id
    LEFT JOIN users u ON u.id = c.assigned_to`;

export const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.direction, m.type, m.body, m.media, m.template_name, m.status,
         m.error_code, m.error_message, m.source, m.sent_by, u.name AS sender_name,
         m.created_at, m.sent_at, m.delivered_at, m.read_at,
         ${CURSOR_TS('m.created_at')} AS cursor_ts
    FROM messages m
    LEFT JOIN users u ON u.id = m.sent_by`;

/** WhatsApp only allows free-form replies within 24 hours of the customer's last message. */
export function isWindowOpen(lastInboundAt) {
  return Boolean(lastInboundAt) && Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS;
}

export function serializeConversation(row) {
  if (!row) return null;
  const { cursorTs: _cursor, ...rest } = row;
  return {
    ...rest,
    windowOpen: isWindowOpen(row.lastInboundAt),
    windowExpiresAt: row.lastInboundAt ? new Date(new Date(row.lastInboundAt).getTime() + WINDOW_MS) : null,
  };
}

export function serializeMessage(row) {
  if (!row) return null;
  const { cursorTs: _cursor, media, ...rest } = row;
  return {
    ...rest,
    // Storage keys stay on the server; the client fetches media through /api/media/:messageId.
    media: media
      ? {
          mimeType: media.mimeType ?? null,
          filename: media.filename ?? null,
          size: media.size ?? null,
          available: Boolean(media.storageKey || media.waMediaId),
        }
      : null,
  };
}

export async function getConversation(workspaceId, id, q = db) {
  return serializeConversation(
    await q.one(`${CONVERSATION_SELECT} WHERE c.workspace_id = $1 AND c.id = $2`, [workspaceId, id]),
  );
}

export async function getMessage(workspaceId, id, q = db) {
  return serializeMessage(await q.one(`${MESSAGE_SELECT} WHERE m.workspace_id = $1 AND m.id = $2`, [workspaceId, id]));
}

/** Find or create the single conversation for a contact. */
export async function ensureConversation(q, workspaceId, contactId) {
  return q.one(
    `INSERT INTO conversations (workspace_id, contact_id) VALUES ($1, $2)
     ON CONFLICT (workspace_id, contact_id) DO UPDATE SET updated_at = now()
     RETURNING id, status, assigned_to, last_inbound_at`,
    [workspaceId, contactId],
  );
}

export function previewFor(type, body, media) {
  const text = (body ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  switch (type) {
    case 'image':
      return text ? `📷 ${text}` : '📷 Photo';
    case 'video':
      return text ? `🎥 ${text}` : '🎥 Video';
    case 'audio':
      return '🎤 Audio';
    case 'sticker':
      return 'Sticker';
    case 'document':
      return `📄 ${media?.filename || text || 'Document'}`;
    case 'location':
      return '📍 Location';
    case 'contacts':
      return '👤 Contact card';
    default:
      return text || 'Message';
  }
}

/** Update the denormalised "last message" fields shown in the conversation list. */
export async function touchConversation(q, conversationId, { preview, direction, at = new Date(), inbound = false }) {
  await q.exec(
    `UPDATE conversations
        SET last_message_at = GREATEST(last_message_at, $2::timestamptz),
            last_message_preview = $3,
            last_message_direction = $4,
            unread_count = unread_count + $5::int,
            last_inbound_at = CASE WHEN $5::int = 1 THEN $2::timestamptz ELSE last_inbound_at END,
            status = CASE WHEN $5::int = 1 THEN 'open' ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [conversationId, at, preview, direction, inbound ? 1 : 0],
  );
}

export const encodeCursor = (ts, id) => Buffer.from(JSON.stringify([ts, id])).toString('base64url');

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [ts, id] = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (typeof ts !== 'string' || typeof id !== 'string' || Number.isNaN(Date.parse(ts))) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { ts, id };
  } catch {
    return null;
  }
}
