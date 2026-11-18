import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';

/** Saved replies: answers the team sends often. Everyone in the workspace shares one list and can edit it. */
export const savedRepliesRouter = Router();
savedRepliesRouter.use(requireAuth);

const MAX_SAVED_REPLIES = 200;
const COLUMNS = 'id, title, body, created_at, updated_at';
const replyBody = z.object({
  title: z.string().trim().min(1, 'Give it a short name').max(80),
  body: z.string().trim().min(1, 'Write the reply').max(4096),
});

savedRepliesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await db.many(`SELECT ${COLUMNS} FROM saved_replies WHERE workspace_id = $1 ORDER BY lower(title), created_at`, [
      req.user.workspaceId,
    ]);
    res.json({ items });
  }),
);

savedRepliesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(replyBody, req.body);
    const { count } = await db.one('SELECT count(*)::int AS count FROM saved_replies WHERE workspace_id = $1', [req.user.workspaceId]);
    if (count >= MAX_SAVED_REPLIES) throw badRequest(`You can keep up to ${MAX_SAVED_REPLIES} saved replies. Delete one you no longer use.`);
    const row = await db.one(
      `INSERT INTO saved_replies (workspace_id, title, body, created_by) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [req.user.workspaceId, body.title, body.body, req.user.id],
    );
    res.status(201).json(row);
  }),
);

savedRepliesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(replyBody.partial(), req.body);
    const row = await db.one(
      `UPDATE saved_replies SET title = COALESCE($3, title), body = COALESCE($4, body), updated_at = now()
        WHERE workspace_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
      [req.user.workspaceId, id, body.title ?? null, body.body ?? null],
    );
    if (!row) throw notFound('Saved reply');
    res.json(row);
  }),
);

savedRepliesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const deleted = await db.exec('DELETE FROM saved_replies WHERE workspace_id = $1 AND id = $2', [req.user.workspaceId, id]);
    if (!deleted) throw notFound('Saved reply');
    res.json({ ok: true });
  }),
);
