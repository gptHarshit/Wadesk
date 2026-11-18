import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { requireAuth, requireManager } from '../middleware/auth.js';
import { splitKeywords, tidyKeywords } from '../services/autoReply.js';
import { DEFAULT_AWAY_MESSAGE, DEFAULT_DAYS, DEFAULT_TIMEZONE, isOpenAt, isValidTimezone, toMinutes } from '../services/officeHours.js';

export const autoRepliesRouter = Router();
autoRepliesRouter.use(requireAuth);

const COLUMNS = 'id, keyword, match_type, reply_text, is_active, created_at, updated_at';
const ruleBody = z.object({
  // Several keywords can share one reply: "hi, hello, hey". Stored tidy so the list reads well.
  keyword: z
    .string()
    .trim()
    .max(500, 'Keep the keywords under 500 characters')
    .transform(tidyKeywords)
    .refine((v) => v.length > 0, 'Keyword is required')
    .refine((v) => splitKeywords(v).every((k) => k.length <= 100), 'Each keyword can be up to 100 characters'),
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

/* ---- Away message (outside office hours) ---- */

const dayBody = z
  .object({
    open: z.boolean(),
    start: z.string().refine((v) => toMinutes(v) !== null, 'Use a time like 10:00'),
    end: z.string().refine((v) => toMinutes(v) !== null, 'Use a time like 19:00'),
  })
  .refine((d) => !d.open || d.start !== d.end, 'Opening and closing time can’t be the same');

const awayBody = z
  .object({
    enabled: z.boolean(),
    message: z.string().trim().max(4096),
    timezone: z.string().trim().refine(isValidTimezone, 'Unknown time zone'),
    days: z.array(dayBody).length(7),
  })
  .refine((b) => !b.enabled || b.message.length > 0, { message: 'Write the away message', path: ['message'] });

function describeAway(row) {
  const timezone = isValidTimezone(row.timezone) ? row.timezone : DEFAULT_TIMEZONE;
  const days = Array.isArray(row.officeHours) && row.officeHours.length === 7 ? row.officeHours : DEFAULT_DAYS;
  return {
    enabled: row.awayEnabled,
    message: row.awayMessage ?? DEFAULT_AWAY_MESSAGE,
    timezone,
    days,
    openNow: isOpenAt(days, new Date(), timezone),
  };
}

autoRepliesRouter.get(
  '/away',
  asyncHandler(async (req, res) => {
    const row = await db.one('SELECT away_enabled, away_message, office_hours, timezone FROM workspaces WHERE id = $1', [
      req.user.workspaceId,
    ]);
    res.json(describeAway(row));
  }),
);

autoRepliesRouter.put(
  '/away',
  requireManager,
  asyncHandler(async (req, res) => {
    const body = parse(awayBody, req.body);
    const days = body.days.map((d) => ({ open: d.open, start: d.start, end: d.end }));
    const row = await db.one(
      `UPDATE workspaces SET away_enabled = $2, away_message = $3, timezone = $4, office_hours = $5::jsonb, updated_at = now()
        WHERE id = $1 RETURNING away_enabled, away_message, office_hours, timezone`,
      [req.user.workspaceId, body.enabled, body.message || null, body.timezone, JSON.stringify(days)],
    );
    res.json(describeAway(row));
  }),
);

/* ---- Keyword rules ---- */

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
