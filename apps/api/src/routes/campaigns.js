import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { idParam, limit, page, parse, uuid } from '../lib/validate.js';
import { requireAuth, requireManager } from '../middleware/auth.js';
import { campaignQueue } from '../queues.js';
import { CAMPAIGN_SELECT, campaignReportCsv, cancelCampaign, countAudience, previewCampaign } from '../services/campaigns.js';
import { DEFAULT_TIMEZONE, isValidTimezone } from '../services/officeHours.js';
import { assertTags } from '../services/contacts.js';
import { buildTemplateMessage, sanitizeVariables } from '../services/templates.js';
import { requireAccount } from '../services/whatsapp.js';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('tags'), tagIds: z.array(uuid).min(1, 'Pick at least one tag').max(50) }),
]);

// Stand-in used to check a campaign's variables: every merge field resolves to "[field]".
const SAMPLE_CONTACT = { sample: true };

async function getCampaign(workspaceId, id) {
  return db.one(`${CAMPAIGN_SELECT} WHERE c.workspace_id = $1 AND c.id = $2`, [workspaceId, id]);
}

campaignsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ page, limit: limit(100, 20) }), req.query);
    const [{ total }, items] = await Promise.all([
      db.one('SELECT count(*)::int AS total FROM campaigns WHERE workspace_id = $1', [req.user.workspaceId]),
      db.many(`${CAMPAIGN_SELECT} WHERE c.workspace_id = $1 ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`, [
        req.user.workspaceId,
        q.limit,
        (q.page - 1) * q.limit,
      ]),
    ]);
    res.json({ items, total, page: q.page, limit: q.limit });
  }),
);

/** How many contacts an audience would reach right now. */
campaignsRouter.post(
  '/audience-count',
  asyncHandler(async (req, res) => {
    const audience = parse(audienceSchema, req.body?.audience);
    if (audience.type === 'tags') await assertTags(db, req.user.workspaceId, audience.tagIds);
    res.json({ count: await countAudience(req.user.workspaceId, audience) });
  }),
);

/** Dry run: real rendered messages for a few recipients, plus who is missing data. Sends nothing. */
campaignsRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ templateId: uuid, variables: z.unknown().optional(), audience: audienceSchema }), req.body);
    const workspaceId = req.user.workspaceId;
    const template = await db.one(
      'SELECT id, name, language, status, components, parameter_format FROM templates WHERE workspace_id = $1 AND id = $2',
      [workspaceId, body.templateId],
    );
    if (!template) throw notFound('Template');
    if (body.audience.type === 'tags') body.audience.tagIds = await assertTags(db, workspaceId, body.audience.tagIds);
    const variables = sanitizeVariables(body.variables);
    try {
      buildTemplateMessage(template, variables, SAMPLE_CONTACT);
    } catch (err) {
      throw badRequest(err.message);
    }
    res.json(await previewCampaign(workspaceId, template, variables, body.audience));
  }),
);

campaignsRouter.post(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1, 'Give the campaign a name').max(120),
        templateId: uuid,
        variables: z.unknown().optional(),
        audience: audienceSchema,
      }),
      req.body,
    );
    const workspaceId = req.user.workspaceId;
    const template = await db.one(
      'SELECT id, name, language, status, components, parameter_format FROM templates WHERE workspace_id = $1 AND id = $2',
      [workspaceId, body.templateId],
    );
    if (!template) throw notFound('Template');
    if (template.status !== 'APPROVED') throw badRequest('Only approved templates can be used in a campaign');
    if (body.audience.type === 'tags') body.audience.tagIds = await assertTags(db, workspaceId, body.audience.tagIds);

    // Catch missing variables now rather than as thousands of failed sends later.
    const variables = sanitizeVariables(body.variables);
    try {
      buildTemplateMessage(template, variables, SAMPLE_CONTACT);
    } catch (err) {
      throw badRequest(err.message);
    }

    const row = await db.one(
      `INSERT INTO campaigns (workspace_id, name, template_id, template_name, template_language, variables, audience, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8) RETURNING id`,
      [
        workspaceId,
        body.name,
        template.id,
        template.name,
        template.language,
        JSON.stringify(variables),
        JSON.stringify(body.audience),
        req.user.id,
      ],
    );
    res.status(201).json(await getCampaign(workspaceId, row.id));
  }),
);

campaignsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const campaign = await getCampaign(req.user.workspaceId, id);
    if (!campaign) throw notFound('Campaign');
    const notSentYet = campaign.status === 'draft' || campaign.status === 'scheduled';
    const audienceSize = notSentYet ? await countAudience(req.user.workspaceId, campaign.audience) : null;
    res.json({ ...campaign, audienceSize });
  }),
);

campaignsRouter.get(
  '/:id/recipients',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const q = parse(
      z.object({
        status: z.enum(['pending', 'sent', 'delivered', 'read', 'failed', 'skipped']).optional(),
        page,
        limit: limit(100, 25),
      }),
      req.query,
    );
    const params = [req.user.workspaceId, id, q.status ?? null];
    const where = 'r.workspace_id = $1 AND r.campaign_id = $2 AND ($3::text IS NULL OR r.status = $3::text)';
    const [{ total }, items] = await Promise.all([
      db.one(`SELECT count(*)::int AS total FROM campaign_recipients r WHERE ${where}`, params),
      db.many(
        `SELECT r.id, r.status, r.error_code, r.error_message, r.updated_at,
                ct.id AS contact_id, ct.name AS contact_name, ct.phone AS contact_phone
           FROM campaign_recipients r JOIN contacts ct ON ct.id = r.contact_id
          WHERE ${where}
          ORDER BY r.updated_at DESC, r.id LIMIT $4 OFFSET $5`,
        [...params, q.limit, (q.page - 1) * q.limit],
      ),
    ]);
    res.json({ items, total, page: q.page, limit: q.limit });
  }),
);

campaignsRouter.post(
  '/:id/launch',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const workspaceId = req.user.workspaceId;
    await requireAccount(workspaceId);

    const campaign = await getCampaign(workspaceId, id);
    if (!campaign) throw notFound('Campaign');
    if (campaign.status !== 'draft') throw badRequest('This campaign has already been launched');
    if (!campaign.templateId) throw badRequest('The template for this campaign no longer exists');
    if ((await countAudience(workspaceId, campaign.audience)) === 0) {
      throw badRequest('No contacts match this audience (opted-out contacts are excluded)');
    }

    // The status check in SQL makes a double click launch only once.
    const queued = await db.one(
      `UPDATE campaigns SET status = 'queued' WHERE id = $1 AND workspace_id = $2 AND status = 'draft' RETURNING id`,
      [id, workspaceId],
    );
    if (!queued) throw badRequest('This campaign has already been launched');
    await campaignQueue.add('prepare', { campaignId: id }, { jobId: `campaign_${id}` });

    res.json(await getCampaign(workspaceId, id));
  }),
);

const MIN_SCHEDULE_MS = 2 * 60 * 1000;
const MAX_SCHEDULE_MS = 60 * 24 * 60 * 60 * 1000;

/** Send a draft automatically at a later time. */
campaignsRouter.post(
  '/:id/schedule',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ sendAt: z.string().datetime({ offset: true, message: 'Pick a date and time' }) }), req.body);
    const sendAt = new Date(body.sendAt);
    const ahead = sendAt.getTime() - Date.now();
    if (ahead < MIN_SCHEDULE_MS) throw badRequest('Pick a time at least 2 minutes from now, or use Send now');
    if (ahead > MAX_SCHEDULE_MS) throw badRequest('Campaigns can be scheduled up to 60 days ahead');

    const workspaceId = req.user.workspaceId;
    await requireAccount(workspaceId);
    const campaign = await getCampaign(workspaceId, id);
    if (!campaign) throw notFound('Campaign');
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') throw badRequest('This campaign has already been sent');
    if (!campaign.templateId) throw badRequest('The template for this campaign no longer exists');
    if ((await countAudience(workspaceId, campaign.audience)) === 0) {
      throw badRequest('No contacts match this audience (opted-out contacts are excluded)');
    }

    const row = await db.one(
      `UPDATE campaigns SET status = 'scheduled', scheduled_at = $3
        WHERE id = $1 AND workspace_id = $2 AND status IN ('draft', 'scheduled') RETURNING id`,
      [id, workspaceId, sendAt],
    );
    if (!row) throw badRequest('This campaign has already been sent');
    res.json(await getCampaign(workspaceId, id));
  }),
);

/** Take a scheduled campaign back to draft, so it is not sent. */
campaignsRouter.post(
  '/:id/unschedule',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const row = await db.one(
      `UPDATE campaigns SET status = 'draft', scheduled_at = NULL
        WHERE id = $1 AND workspace_id = $2 AND status = 'scheduled' RETURNING id`,
      [id, req.user.workspaceId],
    );
    if (!row) throw badRequest('This campaign is not scheduled any more (it may have started sending)');
    res.json(await getCampaign(req.user.workspaceId, id));
  }),
);

/** Download who got the campaign and what happened, as a CSV file. */
campaignsRouter.get(
  '/:id/report.csv',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const campaign = await getCampaign(req.user.workspaceId, id);
    if (!campaign) throw notFound('Campaign');
    const workspace = await db.one('SELECT timezone FROM workspaces WHERE id = $1', [req.user.workspaceId]);
    const timeZone = isValidTimezone(workspace?.timezone) ? workspace.timezone : DEFAULT_TIMEZONE;
    const csv = await campaignReportCsv(req.user.workspaceId, id, timeZone);
    const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'campaign';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-report.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }),
);

campaignsRouter.post(
  '/:id/cancel',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    if (!(await cancelCampaign(req.user.workspaceId, id))) {
      throw badRequest('Only a campaign that is still sending can be cancelled');
    }
    res.json(await getCampaign(req.user.workspaceId, id));
  }),
);

campaignsRouter.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const deleted = await db.exec(
      `DELETE FROM campaigns WHERE workspace_id = $1 AND id = $2 AND status NOT IN ('queued', 'sending')`,
      [req.user.workspaceId, id],
    );
    if (!deleted) throw badRequest('Campaign not found, or it is still sending (cancel it first)');
    res.json({ ok: true });
  }),
);
