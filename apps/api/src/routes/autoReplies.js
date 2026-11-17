import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { requireAuth, requireManager } from '../middleware/auth.js';

export const autoRepliesRouter = Router();
autoRepliesRouter.use(requireAuth);

const COLUMNS = 'id, keyword, match_type, reply_text, is_active, created_at, updated_at';
const ruleBody = z.object({
  keyword: z.string().trim().min(1, 'Keyword is required').max(100),
  matchType: z.enum(['exact', 'contains', 'starts_with']).default('contains'),
  replyText: z.string().trim().min(1, 'Reply is required').max(4096),
  isActive: z.boolean().default(true),
});

autoRepliesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await db.many(`SELECT ${COLUMNS} FROM auto_replies WHERE workspace_id = $1 ORDER BY created_at DESC`, [
      req.user.workspaceId,
    ]);
    res.json({ items });
  }),
);

autoRepliesRouter.post(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const body = parse(ruleBody, req.body);
    const rule = await db.one(
      `INSERT INTO auto_replies (workspace_id, keyword, match_type, reply_text, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [req.user.workspaceId, body.keyword, body.matchType, body.replyText, body.isActive],
    );
    res.status(201).json(rule);
  }),
);

autoRepliesRouter.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(ruleBody.partial(), req.body);
    const rule = await db.one(
      `UPDATE auto_replies
          SET keyword = COALESCE($3, keyword), match_type = COALESCE($4, match_type),
              reply_text = COALESCE($5, reply_text), is_active = COALESCE($6, is_active), updated_at = now()
        WHERE workspace_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
      [req.user.workspaceId, id, body.keyword ?? null, body.matchType ?? null, body.replyText ?? null, body.isActive ?? null],
    );
    if (!rule) throw notFound('Auto-reply');
    res.json(rule);
  }),
);

autoRepliesRouter.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const deleted = await db.exec('DELETE FROM auto_replies WHERE workspace_id = $1 AND id = $2', [req.user.workspaceId, id]);
    if (!deleted) throw notFound('Auto-reply');
    res.json({ ok: true });
  }),
);
