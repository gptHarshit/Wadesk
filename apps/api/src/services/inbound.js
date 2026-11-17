import { config } from '../config.js';
import { db } from '../db.js';
import { isBsuid, normalizePhone } from '../lib/phone.js';
import { saveFile } from '../lib/storage.js';
import { logger } from '../logger.js';
import { publish } from '../realtime.js';
import { maybeAutoReply } from './autoReply.js';
import { upsertInboundContact } from './contacts.js';
import { ensureConversation, getConversation, getMessage, previewFor, touchConversation } from './conversations.js';
import { downloadMedia, getAccount } from './whatsapp.js';

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);
const OPT_OUT_WORDS = new Set(['stop', 'unsubscribe']);
const OPT_IN_WORDS = new Set(['start', 'subscribe']);

const fromUnix = (seconds) => {
  const ms = Number(seconds) * 1000;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date();
};

/**
 * Time used to order an incoming message in its thread. WhatsApp timestamps
 * only have one-second precision, so for live traffic we use our own clock
 * (otherwise a quick reply could sort above the message it answers). For
 * webhooks that arrive late, e.g. after an outage, we keep WhatsApp's time.
 */
const arrivalTime = (seconds) => {
  const sentAt = fromUnix(seconds);
  const lag = Date.now() - sentAt.getTime();
  return lag >= 0 && lag < 60_000 ? new Date() : sentAt;
};

/** Turn one webhook message object into what we store. Returns null for things we ignore. */
export function parseInboundMessage(m) {
  const type = String(m.type ?? 'unknown');
  if (MEDIA_TYPES.has(type)) {
    const media = m[type] ?? {};
    return {
      type,
      body: media.caption ?? null,
      media: media.id
        ? { waMediaId: media.id, mimeType: media.mime_type ?? null, filename: media.filename ?? null }
        : null,
    };
  }
  switch (type) {
    case 'text':
      return { type: 'text', body: m.text?.body ?? '', media: null };
    case 'button':
      return { type: 'text', body: m.button?.text ?? m.button?.payload ?? '', media: null };
    case 'interactive': {
      const i = m.interactive ?? {};
      return { type: 'text', body: i.button_reply?.title ?? i.list_reply?.title ?? '[Form or interactive reply]', media: null };
    }
    case 'location': {
      const l = m.location ?? {};
      const link = `https://maps.google.com/?q=${l.latitude},${l.longitude}`;
      return { type: 'location', body: [l.name, l.address, link].filter(Boolean).join('\n'), media: null };
    }
    case 'contacts': {
      const lines = (m.contacts ?? []).map((c) => {
        const phones = (c.phones ?? []).map((p) => p.phone).filter(Boolean).join(', ');
        return [c.name?.formatted_name ?? 'Contact', phones].filter(Boolean).join(': ');
      });
      return { type: 'contacts', body: lines.join('\n'), media: null };
    }
    case 'reaction':
      return null;
    default:
      return { type: 'unsupported', body: m.errors?.[0]?.title ?? 'This message type is not supported yet', media: null };
  }
}

/** Entry point for the webhook worker: one Meta webhook POST body for one workspace. */
export async function processWebhookPayload(workspaceId, payload) {
  const account = await getAccount(workspaceId);
  if (!account) {
    logger.warn({ workspaceId }, 'Webhook for a workspace with no WhatsApp connection; dropped');
    return;
  }

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'messages') continue;
      const value = change.value ?? {};
      if (value.metadata?.phone_number_id && value.metadata.phone_number_id !== account.phoneNumberId) {
        logger.warn({ workspaceId, got: value.metadata.phone_number_id }, 'Webhook for a different phone number; skipped');
        continue;
      }
      const profiles = value.contacts ?? [];
      for (const message of value.messages ?? []) {
        if (message.type === 'system') await handleSystemMessage(workspaceId, message);
        else await handleInboundMessage(workspaceId, account, message, profiles);
      }
      for (const status of value.statuses ?? []) {
        await handleStatus(workspaceId, status);
      }
    }
  }
}

function identify(message, profiles) {
  // Phone numbers can be absent when the customer uses a WhatsApp username; the BSUID is then the only ID.
  const rawFrom = message.from ?? null;
  const profile =
    profiles.find((p) => (rawFrom && p.wa_id === rawFrom) || (message.from_user_id && p.user_id === message.from_user_id)) ??
    profiles[0] ??
    {};
  const waUserId = message.from_user_id ?? profile.user_id ?? (isBsuid(rawFrom) ? rawFrom : null);
  const phone = normalizePhone(isBsuid(rawFrom) ? profile.wa_id : (rawFrom ?? profile.wa_id));
  return {
    phone,
    waUserId: waUserId ?? null,
    username: profile.profile?.username ?? null,
    profileName: profile.profile?.name ?? null,
  };
}

async function handleInboundMessage(workspaceId, account, m, profiles) {
  const parsed = parseInboundMessage(m);
  if (!parsed || !m.id) return;
  const identity = identify(m, profiles);
  if (!identity.phone && !identity.waUserId) {
    logger.warn({ workspaceId, waMessageId: m.id }, 'Incoming message without a sender; dropped');
    return;
  }
  const receivedAt = arrivalTime(m.timestamp);

  const stored = await db.tx(async (t) => {
    const contact = await upsertInboundContact(t, workspaceId, identity);
    const conversation = await ensureConversation(t, workspaceId, contact.id);
    // Meta retries webhooks, so the same message can arrive more than once.
    const row = await t.one(
      `INSERT INTO messages
         (workspace_id, conversation_id, contact_id, direction, type, body, media, wa_message_id, status, created_at)
       VALUES ($1, $2, $3, 'in', $4, $5, $6::jsonb, $7, 'received', $8)
       ON CONFLICT (workspace_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        workspaceId,
        conversation.id,
        contact.id,
        parsed.type,
        parsed.body,
        parsed.media ? JSON.stringify(parsed.media) : null,
        m.id,
        receivedAt,
      ],
    );
    if (!row) return null;
    await touchConversation(t, conversation.id, {
      preview: previewFor(parsed.type, parsed.body, parsed.media),
      direction: 'in',
      at: receivedAt,
      inbound: true,
    });
    return { messageId: row.id, conversationId: conversation.id, contact };
  });
  if (!stored) return;

  if (parsed.media) await storeInboundMedia(workspaceId, account, stored.messageId, parsed.media);

  const [message, conversation] = await Promise.all([
    getMessage(workspaceId, stored.messageId),
    getConversation(workspaceId, stored.conversationId),
  ]);
  await publish(workspaceId, 'message:new', { message, conversation });

  if (parsed.type !== 'text' || !parsed.body) return;
  const word = parsed.body.trim().toLowerCase();
  if (OPT_OUT_WORDS.has(word) || OPT_IN_WORDS.has(word)) {
    await db.exec('UPDATE contacts SET opted_out = $2, updated_at = now() WHERE id = $1', [
      stored.contact.id,
      OPT_OUT_WORDS.has(word),
    ]);
  }
  try {
    await maybeAutoReply({ workspaceId, conversationId: stored.conversationId, contact: stored.contact, text: parsed.body });
  } catch (err) {
    logger.error({ err, workspaceId }, 'Auto-reply failed');
  }
}

/** Download media from Meta into our storage. Failure is not fatal: the media route retries on demand. */
export async function storeInboundMedia(workspaceId, account, messageId, media) {
  try {
    const { buffer, mimeType } = await downloadMedia(account, media.waMediaId, config.maxUploadBytes * 4);
    const finalMime = media.mimeType ?? mimeType;
    const storageKey = await saveFile(workspaceId, buffer, finalMime);
    const stored = { ...media, mimeType: finalMime, storageKey, size: buffer.length };
    await db.exec('UPDATE messages SET media = $2::jsonb WHERE id = $1', [messageId, JSON.stringify(stored)]);
    return stored;
  } catch (err) {
    logger.warn({ err: err.message, workspaceId, messageId }, 'Could not download incoming media');
    return null;
  }
}

/** Delivery receipts: sent → delivered → read, or failed. Never moves a message backwards. */
async function handleStatus(workspaceId, s) {
  const status = String(s.status ?? '');
  if (!['sent', 'delivered', 'read', 'failed'].includes(status) || !s.id) return;
  const at = fromUnix(s.timestamp);
  const error = s.errors?.[0];
  const errorCode = error?.code !== undefined ? String(error.code) : null;
  const errorMessage = error
    ? [error.title ?? error.message, error.error_data?.details].filter(Boolean).join(' — ').slice(0, 500) || null
    : null;

  const message = await db.one(
    `UPDATE messages SET
        status = $3::text,
        sent_at = CASE WHEN $3::text <> 'failed' THEN COALESCE(sent_at, $4::timestamptz) ELSE sent_at END,
        delivered_at = CASE WHEN $3::text IN ('delivered', 'read') THEN COALESCE(delivered_at, $4::timestamptz) ELSE delivered_at END,
        read_at = CASE WHEN $3::text = 'read' THEN COALESCE(read_at, $4::timestamptz) ELSE read_at END,
        error_code = CASE WHEN $3::text = 'failed' THEN $5::text ELSE error_code END,
        error_message = CASE WHEN $3::text = 'failed' THEN $6::text ELSE error_message END
      WHERE workspace_id = $1 AND wa_message_id = $2 AND direction = 'out'
        AND (($3::text = 'sent' AND status = 'queued')
          OR ($3::text = 'delivered' AND status IN ('queued', 'sent'))
          OR ($3::text = 'read' AND status IN ('queued', 'sent', 'delivered'))
          OR ($3::text = 'failed' AND status IN ('queued', 'sent')))
      RETURNING id, conversation_id, status, error_code, error_message, sent_at, delivered_at, read_at`,
    [workspaceId, s.id, status, at, errorCode, errorMessage],
  );

  await db.exec(
    `UPDATE campaign_recipients SET
        status = $3::text,
        error_code = CASE WHEN $3::text = 'failed' THEN $4::text ELSE error_code END,
        error_message = CASE WHEN $3::text = 'failed' THEN $5::text ELSE error_message END,
        updated_at = now()
      WHERE workspace_id = $1 AND wa_message_id = $2
        AND (($3::text = 'delivered' AND status = 'sent')
          OR ($3::text = 'read' AND status IN ('sent', 'delivered'))
          OR ($3::text = 'failed' AND status = 'sent'))`,
    [workspaceId, s.id, status, errorCode, errorMessage],
  );

  if (message) {
    await publish(workspaceId, 'message:status', {
      id: message.id,
      conversationId: message.conversationId,
      status: message.status,
      errorCode: message.errorCode,
      errorMessage: message.errorMessage,
      sentAt: message.sentAt,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
    });
  }
}

/** A customer changed their number or their business-scoped user ID was regenerated. */
async function handleSystemMessage(workspaceId, m) {
  const sys = m.system ?? {};
  const kind = sys.type ?? '';
  if (kind !== 'user_changed_number' && kind !== 'user_changed_user_id') return;

  const previousUserId = sys.previous_user_id ?? m.previous_user_id ?? null;
  const newUserId = sys.user_id ?? m.user_id ?? m.from_user_id ?? null;
  const oldPhone = normalizePhone(isBsuid(m.from) ? null : m.from);
  const newPhone = normalizePhone(sys.wa_id ?? sys.new_wa_id);

  try {
    if (previousUserId && newUserId) {
      await db.exec(
        'UPDATE contacts SET wa_user_id = $3, updated_at = now() WHERE workspace_id = $1 AND wa_user_id = $2',
        [workspaceId, previousUserId, newUserId],
      );
    }
    if (newPhone && (oldPhone || newUserId)) {
      await db.exec(
        `UPDATE contacts SET phone = $2, updated_at = now()
          WHERE workspace_id = $1 AND (($3::text IS NOT NULL AND phone = $3::text) OR ($4::text IS NOT NULL AND wa_user_id = $4::text))
            AND NOT EXISTS (SELECT 1 FROM contacts c2 WHERE c2.workspace_id = $1 AND c2.phone = $2)`,
        [workspaceId, newPhone, oldPhone, newUserId],
      );
    }
  } catch (err) {
    logger.warn({ err: err.message, workspaceId }, 'Could not apply contact identity change');
  }
}
