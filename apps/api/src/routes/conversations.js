import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError, asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { baseMime, openFile, saveFile, statFile } from '../lib/storage.js';
import { idParam, limit, parse, uuid } from '../lib/validate.js';
import { logger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { publish } from '../realtime.js';
import {
  CONVERSATION_SELECT,
  MESSAGE_SELECT,
  decodeCursor,
  encodeCursor,
  ensureConversation,
  getConversation,
  isWindowOpen,
  serializeConversation,
  serializeMessage,
} from '../services/conversations.js';
import { storeInboundMedia } from '../services/inbound.js';
import { deliver } from '../services/outbound.js';
import { buildTemplateMessage, sanitizeVariables } from '../services/templates.js';
import { getAccount, markAsRead, requireAccount, sendMedia, sendTemplate, sendText, uploadMedia } from '../services/whatsapp.js';

export const conversationsRouter = Router();
export const mediaRouter = Router();
conversationsRouter.use(requireAuth);
mediaRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
const likePattern = (term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;
const IMAGE_LIMIT = 5 * 1024 * 1024; // WhatsApp's own limit for images

/** Load the conversation plus the contact fields needed to address a message. */
async function loadThread(req) {
  const { id } = parse(idParam, req.params);
  const row = await db.one(
    `SELECT c.id, c.status, c.last_inbound_at,
            ct.id AS contact_id, ct.phone, ct.wa_user_id, ct.name, ct.email
       FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.workspace_id = $1 AND c.id = $2`,
    [req.user.workspaceId, id],
  );
  if (!row) throw notFound('Conversation');
  return {
    id: row.id,
    status: row.status,
    lastInboundAt: row.lastInboundAt,
    contact: { id: row.contactId, phone: row.phone, waUserId: row.waUserId, name: row.name, email: row.email },
  };
}

function assertWindowOpen(thread) {
  if (!isWindowOpen(thread.lastInboundAt)) {
    throw new HttpError(
      400,
      'window_closed',
      'The 24-hour reply window is closed. WhatsApp only allows an approved template until the customer writes again.',
    );
  }
}

/* --------------------------------- Listing --------------------------------- */

conversationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(['open', 'closed', 'all']).default('open'),
        assigned: z.enum(['all', 'me', 'unassigned']).default('all'),
        search: z.string().trim().max(100).optional(),
        cursor: z.string().max(300).optional(),
        limit: limit(100, 30),
      }),
      req.query,
    );
    const where = ['c.workspace_id = $1'];
    const params = [req.user.workspaceId];
    const add = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (q.status !== 'all') where.push(`c.status = ${add(q.status)}`);
    if (q.assigned === 'me') where.push(`c.assigned_to = ${add(req.user.id)}`);
    if (q.assigned === 'unassigned') where.push('c.assigned_to IS NULL');
    if (q.search) {
      const text = add(likePattern(q.search));
      const conditions = [`ct.name ILIKE ${text}`, `ct.wa_username ILIKE ${text}`];
      const digits = q.search.replace(/\D/g, '');
      if (digits.length >= 3) conditions.push(`ct.phone LIKE ${add(`%${digits}%`)}`);
      where.push(`(${conditions.join(' OR ')})`);
    }
    const cursor = decodeCursor(q.cursor);
    if (cursor) where.push(`(c.last_message_at, c.id) < (${add(cursor.ts)}::timestamptz, ${add(cursor.id)}::uuid)`);

    const rows = await db.many(
      `${CONVERSATION_SELECT} WHERE ${where.join(' AND ')}
        ORDER BY c.last_message_at DESC, c.id DESC LIMIT ${add(q.limit + 1)}`,
      params,
    );
    const pageRows = rows.slice(0, q.limit);
    const last = pageRows[pageRows.length - 1];
    res.json({
      items: pageRows.map(serializeConversation),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.cursorTs, last.id) : null,
    });
  }),
);

conversationsRouter.get(
  '/counts',
  asyncHandler(async (req, res) => {
    const counts = await db.one(
      `SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
              count(*) FILTER (WHERE status = 'open' AND assigned_to = $2)::int AS mine,
              count(*) FILTER (WHERE status = 'open' AND assigned_to IS NULL)::int AS unassigned,
              count(*) FILTER (WHERE status = 'open' AND unread_count > 0)::int AS unread
         FROM conversations WHERE workspace_id = $1`,
      [req.user.workspaceId, req.user.id],
    );
    res.json(counts);
  }),
);

/** Open (or create) the conversation for a contact, e.g. to message them first with a template. */
conversationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ contactId: uuid }), req.body);
    const contact = await db.one('SELECT id FROM contacts WHERE workspace_id = $1 AND id = $2', [
      req.user.workspaceId,
      body.contactId,
    ]);
    if (!contact) throw notFound('Contact');
    const row = await ensureConversation(db, req.user.workspaceId, contact.id);
    res.status(201).json(await getConversation(req.user.workspaceId, row.id));
  }),
);

conversationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const conversation = await getConversation(req.user.workspaceId, id);
    if (!conversation) throw notFound('Conversation');
    res.json(conversation);
  }),
);

conversationsRouter.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ before: z.string().max(300).optional(), limit: limit(100, 40) }), req.query);
    const cursor = decodeCursor(q.before);

    const rows = await db.many(
      `${MESSAGE_SELECT}
        WHERE m.workspace_id = $1 AND m.conversation_id = $2
          AND ($3::timestamptz IS NULL OR (m.created_at, m.id) < ($3::timestamptz, $4::uuid))
        ORDER BY m.created_at DESC, m.id DESC LIMIT $5`,
      [req.user.workspaceId, id, cursor?.ts ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const pageRows = rows.slice(0, q.limit);
    const oldest = pageRows[pageRows.length - 1];
    res.json({
      items: pageRows.map(serializeMessage).reverse(), // oldest first, ready to render
      nextCursor: rows.length > q.limit && oldest ? encodeCursor(oldest.cursorTs, oldest.id) : null,
    });
  }),
);

/* --------------------------------- Updating --------------------------------- */

conversationsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({ status: z.enum(['open', 'closed']).optional(), assignedTo: uuid.nullable().optional() }),
      req.body,
    );
    if (body.assignedTo) {
      const agent = await db.one(`SELECT id FROM users WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [
        body.assignedTo,
        req.user.workspaceId,
      ]);
      if (!agent) throw badRequest('That team member is not available');
    }
    const updated = await db.exec(
      `UPDATE conversations
          SET status = COALESCE($3, status),
              assigned_to = CASE WHEN $4::boolean THEN $5::uuid ELSE assigned_to END,
              updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
      [req.user.workspaceId, id, body.status ?? null, body.assignedTo !== undefined, body.assignedTo ?? null],
    );
    if (!updated) throw notFound('Conversation');

    const conversation = await getConversation(req.user.workspaceId, id);
    await publish(req.user.workspaceId, 'conversation:updated', { conversation });
    res.json(conversation);
  }),
);

conversationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const row = await db.one(
      `UPDATE conversations SET unread_count = 0, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 RETURNING id`,
      [req.user.workspaceId, id],
    );
    if (!row) throw notFound('Conversation');

    // Show blue ticks on the customer's phone. Best effort: never fail the request over it.
    const lastInbound = await db.one(
      `SELECT wa_message_id FROM messages
        WHERE conversation_id = $1 AND direction = 'in' AND wa_message_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    if (lastInbound) {
      getAccount(req.user.workspaceId)
        .then((account) => account && markAsRead(account, lastInbound.waMessageId))
        .catch((err) => logger.debug({ err: err.message }, 'Could not send read receipt'));
    }

    const conversation = await getConversation(req.user.workspaceId, id);
    await publish(req.user.workspaceId, 'conversation:updated', { conversation });
    res.json(conversation);
  }),
);

/* --------------------------------- Sending --------------------------------- */

conversationsRouter.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const thread = await loadThread(req);
    const body = parse(z.object({ text: z.string().trim().min(1, 'Type a message').max(4096) }), req.body);
    assertWindowOpen(thread);

    const result = await deliver({
      workspaceId: req.user.workspaceId,
      conversationId: thread.id,
      contact: thread.contact,
      sentBy: req.user.id,
      source: 'agent',
      type: 'text',
      body: body.text,
      send: (account) => sendText(account, thread.contact, body.text),
    });
    res.status(201).json(result);
  }),
);

function mediaKind(mimeType) {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png') return 'image';
  if (mimeType === 'video/mp4' || mimeType === 'video/3gpp') return 'video';
  if (['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'].includes(mimeType)) return 'audio';
  return 'document';
}

conversationsRouter.post(
  '/:id/media',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const thread = await loadThread(req);
    if (!req.file) throw badRequest('Choose a file to send');
    const body = parse(z.object({ caption: z.string().trim().max(1024).optional() }), req.body ?? {});
    assertWindowOpen(thread);
    await requireAccount(req.user.workspaceId);

    const mimeType = baseMime(req.file.mimetype) || 'application/octet-stream';
    const kind = mediaKind(mimeType);
    if (kind === 'image' && req.file.size > IMAGE_LIMIT) throw badRequest('Images can be at most 5 MB');
    // Browsers send non-ASCII file names as latin1 bytes; recover the real name.
    const filename = Buffer.from(req.file.originalname ?? 'file', 'latin1').toString('utf8').slice(0, 240);
    const caption = kind === 'audio' ? null : body.caption || null;

    const storageKey = await saveFile(req.user.workspaceId, req.file.buffer, mimeType);
    const result = await deliver({
      workspaceId: req.user.workspaceId,
      conversationId: thread.id,
      contact: thread.contact,
      sentBy: req.user.id,
      source: 'agent',
      type: kind,
      body: caption,
      media: { storageKey, mimeType, filename, size: req.file.size },
      send: async (account) => {
        const mediaId = await uploadMedia(account, req.file.buffer, mimeType, filename);
        return sendMedia(account, thread.contact, kind, mediaId, { caption, filename });
      },
    });
    res.status(201).json(result);
  }),
);

conversationsRouter.post(
  '/:id/template',
  asyncHandler(async (req, res) => {
    const thread = await loadThread(req);
    const body = parse(z.object({ templateId: uuid, variables: z.unknown().optional() }), req.body);
    const template = await db.one(
      'SELECT id, name, language, status, components, parameter_format FROM templates WHERE workspace_id = $1 AND id = $2',
      [req.user.workspaceId, body.templateId],
    );
    if (!template) throw notFound('Template');
    if (template.status !== 'APPROVED') throw badRequest('Only approved templates can be sent');

    let built;
    try {
      built = buildTemplateMessage(template, sanitizeVariables(body.variables), thread.contact);
    } catch (err) {
      throw badRequest(err.message);
    }

    const result = await deliver({
      workspaceId: req.user.workspaceId,
      conversationId: thread.id,
      contact: thread.contact,
      sentBy: req.user.id,
      source: 'agent',
      type: 'template',
      body: built.text,
      templateName: template.name,
      send: (account) =>
        sendTemplate(account, thread.contact, { name: template.name, language: template.language, components: built.components }),
    });
    res.status(201).json(result);
  }),
);

/* ---------------------------------- Media ---------------------------------- */

// Only these are shown inline; anything else is forced to download so an
// uploaded HTML or SVG file can never run as a page on the API's origin.
const INLINE_TYPES = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/(mp4|3gpp|webm)|application\/pdf)$/;

mediaRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const row = await db.one('SELECT id, media FROM messages WHERE workspace_id = $1 AND id = $2', [req.user.workspaceId, id]);
    if (!row?.media) throw notFound('Media');

    let media = row.media;
    if (!media.storageKey && media.waMediaId) {
      // The download failed when the message arrived; try again now.
      const account = await getAccount(req.user.workspaceId);
      media = (account && (await storeInboundMedia(req.user.workspaceId, account, row.id, media))) || media;
    }
    const stat = media.storageKey ? await statFile(media.storageKey) : null;
    if (!stat) throw notFound('Media');

    const mimeType = baseMime(media.mimeType);
    const inline = INLINE_TYPES.test(mimeType);
    const filename = String(media.filename || `file-${row.id.slice(0, 8)}`).replace(/[\r\n"\\]/g, '_');
    res.set({
      'Content-Type': inline ? mimeType : 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, max-age=3600',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
    openFile(media.storageKey)
      .on('error', (err) => {
        logger.error({ err: err.message }, 'Media stream failed');
        res.destroy(err);
      })
      .pipe(res);
  }),
);
