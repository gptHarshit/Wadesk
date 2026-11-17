import { db } from '../db.js';
import { logger } from '../logger.js';
import { publish } from '../realtime.js';
import { getConversation, getMessage, previewFor, touchConversation } from './conversations.js';
import { WhatsAppError, requireAccount } from './whatsapp.js';

/**
 * Send one message to WhatsApp and record it in the conversation.
 *
 * The message row is written first (status "queued"), then the API is called,
 * then the row becomes "sent" or "failed". A failed send is returned (not
 * thrown) so the inbox can show it in the thread with the reason.
 *
 * `send(account)` performs the actual API call and returns Meta's response.
 */
export async function deliver({
  workspaceId,
  conversationId,
  contact,
  sentBy = null,
  source,
  type,
  body = null,
  media = null,
  templateName = null,
  send,
}) {
  const account = await requireAccount(workspaceId);

  const { id } = await db.one(
    `INSERT INTO messages
       (workspace_id, conversation_id, contact_id, direction, type, body, media, template_name, status, sent_by, source)
     VALUES ($1, $2, $3, 'out', $4, $5, $6::jsonb, $7, 'queued', $8, $9)
     RETURNING id`,
    [workspaceId, conversationId, contact.id, type, body, media ? JSON.stringify(media) : null, templateName, sentBy, source],
  );

  try {
    const response = await send(account);
    const waMessageId = response?.messages?.[0]?.id ?? null;
    await db.exec(`UPDATE messages SET status = 'sent', wa_message_id = $2, sent_at = now() WHERE id = $1`, [id, waMessageId]);
    await rememberUserId(contact, response);
  } catch (err) {
    if (!(err instanceof WhatsAppError)) logger.error({ err, messageId: id }, 'Unexpected error while sending message');
    await db.exec(`UPDATE messages SET status = 'failed', error_code = $2, error_message = $3 WHERE id = $1`, [
      id,
      err instanceof WhatsAppError ? err.code : null,
      err instanceof WhatsAppError ? err.message.slice(0, 500) : 'Could not send this message',
    ]);
  }

  await touchConversation(db, conversationId, { preview: previewFor(type, body, media), direction: 'out' });

  const [message, conversation] = await Promise.all([
    getMessage(workspaceId, id),
    getConversation(workspaceId, conversationId),
  ]);
  await publish(workspaceId, 'message:new', { message, conversation });
  return { message, conversation };
}

/** Meta returns the contact's business-scoped user ID on send; keep it for when their number is hidden. */
export async function rememberUserId(contact, response) {
  const userId = response?.contacts?.[0]?.user_id;
  if (!userId || contact.waUserId) return;
  try {
    await db.exec('UPDATE contacts SET wa_user_id = $2, updated_at = now() WHERE id = $1 AND wa_user_id IS NULL', [
      contact.id,
      userId,
    ]);
  } catch (err) {
    // Another contact row already has this ID; leave both as they are.
    logger.debug({ err: err.message, contactId: contact.id }, 'Could not store WhatsApp user ID');
  }
}
