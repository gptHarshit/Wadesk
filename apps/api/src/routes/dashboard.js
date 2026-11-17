import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { CAMPAIGN_SELECT } from '../services/campaigns.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // The browser sends its time zone so "today" and the daily chart match the user's clock.
    const q = parse(z.object({ tz: z.string().regex(/^[A-Za-z0-9_+\-/]{1,64}$/).default('UTC') }), req.query);
    const workspaceId = req.user.workspaceId;
    const tzRow = await db.one('SELECT name FROM pg_timezone_names WHERE name = $1', [q.tz]);
    const tz = tzRow?.name ?? 'UTC';

    const [totals, daily, campaigns] = await Promise.all([
      db.one(
        `SELECT
           (SELECT count(*)::int FROM contacts WHERE workspace_id = $1) AS contacts,
           (SELECT count(*)::int FROM conversations WHERE workspace_id = $1 AND status = 'open') AS open_conversations,
           (SELECT count(*)::int FROM conversations WHERE workspace_id = $1 AND status = 'open' AND assigned_to IS NULL) AS unassigned,
           (SELECT count(*)::int FROM conversations WHERE workspace_id = $1 AND status = 'open' AND unread_count > 0) AS unread,
           (SELECT count(*)::int FROM campaigns WHERE workspace_id = $1) AS campaigns,
           (SELECT count(*)::int FROM messages
             WHERE workspace_id = $1 AND direction = 'in' AND created_at >= date_trunc('day', now() AT TIME ZONE $2::text) AT TIME ZONE $2::text) AS received_today,
           (SELECT count(*)::int FROM messages
             WHERE workspace_id = $1 AND direction = 'out' AND created_at >= date_trunc('day', now() AT TIME ZONE $2::text) AT TIME ZONE $2::text) AS sent_today`,
        [workspaceId, tz],
      ),
      db.many(
        `WITH days AS (
           SELECT generate_series(date_trunc('day', now() AT TIME ZONE $2::text) - interval '6 days',
                                  date_trunc('day', now() AT TIME ZONE $2::text), interval '1 day') AS day
         )
         SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
                count(m.id) FILTER (WHERE m.direction = 'in')::int AS received,
                count(m.id) FILTER (WHERE m.direction = 'out')::int AS sent
           FROM days d
           LEFT JOIN messages m
             ON m.workspace_id = $1
            AND m.created_at >= d.day AT TIME ZONE $2::text
            AND m.created_at < (d.day + interval '1 day') AT TIME ZONE $2::text
          GROUP BY d.day ORDER BY d.day`,
        [workspaceId, tz],
      ),
      db.many(`${CAMPAIGN_SELECT} WHERE c.workspace_id = $1 ORDER BY c.created_at DESC LIMIT 5`, [workspaceId]),
    ]);

    res.json({ totals, daily, recentCampaigns: campaigns });
  }),
);
