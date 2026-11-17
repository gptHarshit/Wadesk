import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireAuth, requireManager } from '../middleware/auth.js';
import { describeTemplate } from '../services/templates.js';
import { WhatsAppError, fetchTemplates, requireAccount } from '../services/whatsapp.js';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

const present = (row) => ({ ...row, info: describeTemplate(row) });

templatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ status: z.string().trim().max(30).optional() }), req.query);
    const rows = await db.many(
      `SELECT id, wa_template_id, name, language, category, status, parameter_format, components, synced_at
         FROM templates
        WHERE workspace_id = $1 AND ($2::text IS NULL OR status = $2::text)
        ORDER BY name, language`,
      [req.user.workspaceId, q.status ? q.status.toUpperCase() : null],
    );
    const last = await db.one('SELECT max(synced_at) AS last_synced_at FROM templates WHERE workspace_id = $1', [
      req.user.workspaceId,
    ]);
    res.json({ items: rows.map(present), lastSyncedAt: last?.lastSyncedAt ?? null });
  }),
);

/** Pull the current template list from Meta. Templates are created and approved in WhatsApp Manager. */
templatesRouter.post(
  '/sync',
  requireManager,
  asyncHandler(async (req, res) => {
    const workspaceId = req.user.workspaceId;
    const account = await requireAccount(workspaceId);

    let remote;
    try {
      remote = await fetchTemplates(account);
    } catch (err) {
      if (err instanceof WhatsAppError) throw badRequest(`Could not load templates from Meta: ${err.message}`);
      throw err;
    }

    await db.tx(async (t) => {
      for (const tpl of remote) {
        if (!tpl?.id || !tpl.name) continue;
        await t.exec(
          `INSERT INTO templates
             (workspace_id, wa_template_id, name, language, category, status, parameter_format, components, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
           ON CONFLICT (workspace_id, wa_template_id) DO UPDATE SET
             name = EXCLUDED.name, language = EXCLUDED.language, category = EXCLUDED.category,
             status = EXCLUDED.status, parameter_format = EXCLUDED.parameter_format,
             components = EXCLUDED.components, synced_at = now()`,
          [
            workspaceId,
            String(tpl.id),
            tpl.name,
            tpl.language ?? 'en',
            tpl.category ?? null,
            String(tpl.status ?? 'UNKNOWN').toUpperCase(),
            String(tpl.parameter_format ?? 'POSITIONAL').toUpperCase(),
            JSON.stringify(tpl.components ?? []),
          ],
        );
      }
      // Drop templates that were deleted in WhatsApp Manager.
      await t.exec('DELETE FROM templates WHERE workspace_id = $1 AND NOT (wa_template_id = ANY($2::text[]))', [
        workspaceId,
        remote.map((tpl) => String(tpl.id)),
      ]);
    });

    res.json({ synced: remote.length });
  }),
);
