import { db } from '../db.js';
import { logger } from '../logger.js';
import { campaignMessageQueue } from '../queues.js';
import { publish } from '../realtime.js';
import { ensureConversation, getConversation, getMessage, previewFor, touchConversation } from './conversations.js';
import { rememberUserId } from './outbound.js';
import { buildTemplateMessage } from './templates.js';
import { WhatsAppError, getAccount, sendTemplate } from './whatsapp.js';

const ENQUEUE_BATCH = 1000;

const STATS_COLUMNS = `
  count(*)::int AS total,
  count(*) FILTER (WHERE status = 'pending')::int AS pending,
  count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read'))::int AS sent,
  count(*) FILTER (WHERE status IN ('delivered', 'read'))::int AS delivered,
  count(*) FILTER (WHERE status = 'read')::int AS read,
  count(*) FILTER (WHERE status = 'failed')::int AS failed,
  count(*) FILTER (WHERE status = 'skipped')::int AS skipped`;

export const CAMPAIGN_SELECT = `
  SELECT c.id, c.name, c.template_id, c.template_name, c.template_language, c.variables, c.audience, c.status,
         c.total_recipients, c.error_message, c.created_at, c.started_at, c.completed_at,
         u.name AS created_by_name,
         (SELECT row_to_json(s) FROM (SELECT ${STATS_COLUMNS} FROM campaign_recipients r WHERE r.campaign_id = c.id) s) AS stats
    FROM campaigns c
    LEFT JOIN users u ON u.id = c.created_by`;

/** SQL fragment + params selecting the contacts an audience covers (opted-out contacts never receive campaigns). */
function audienceQuery(workspaceId, audience) {
  if (audience?.type === 'tags') {
    return {
      sql: `SELECT DISTINCT ct.id FROM contacts ct JOIN contact_tags x ON x.contact_id = ct.id
             WHERE ct.workspace_id = $1 AND NOT ct.opted_out AND x.tag_id = ANY($2::uuid[])`,
      params: [workspaceId, audience.tagIds ?? []],
    };
  }
  return { sql: 'SELECT ct.id FROM contacts ct WHERE ct.workspace_id = $1 AND NOT ct.opted_out', params: [workspaceId] };
}

export async function countAudience(workspaceId, audience) {
  const { sql, params } = audienceQuery(workspaceId, audience);
  const row = await db.one(`SELECT count(*)::int AS count FROM (${sql}) a`, params);
  return row.count;
}

async function notify(workspaceId, campaignId) {
  await publish(workspaceId, 'campaign:updated', { id: campaignId });
}

/** Mark the campaign completed once nothing is left to send. Safe to call repeatedly. */
async function finalizeIfDone(workspaceId, campaignId) {
  const done = await db.one(
    `UPDATE campaigns SET status = 'completed', completed_at = now()
      WHERE id = $1 AND status = 'sending'
        AND NOT EXISTS (SELECT 1 FROM campaign_recipients WHERE campaign_id = $1 AND status = 'pending')
      RETURNING id`,
    [campaignId],
  );
  if (done) await notify(workspaceId, campaignId);
}

/** Step 1 (campaign queue): snapshot the audience into campaign_recipients and enqueue one job per recipient. */
export async function prepareCampaign(campaignId) {
  const campaign = await db.one('SELECT id, workspace_id, audience, status FROM campaigns WHERE id = $1', [campaignId]);
  if (!campaign || !['queued', 'sending'].includes(campaign.status)) return;

  if (campaign.status === 'queued') {
    const { sql, params } = audienceQuery(campaign.workspaceId, campaign.audience);
    const offset = params.length;
    await db.tx(async (t) => {
      await t.exec(
        `INSERT INTO campaign_recipients (campaign_id, workspace_id, contact_id)
         SELECT $${offset + 1}::uuid, $1::uuid, a.id FROM (${sql}) a
         ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
        [...params, campaignId],
      );
      await t.exec(
        `UPDATE campaigns SET status = 'sending', started_at = now(),
                total_recipients = (SELECT count(*) FROM campaign_recipients WHERE campaign_id = $1)
          WHERE id = $1`,
        [campaignId],
      );
    });
  }

  // Enqueue in batches. Job IDs are derived from recipient IDs, so a retry of this step can't double-send.
  let lastId = null;
  for (;;) {
    const batch = await db.many(
      `SELECT id FROM campaign_recipients
        WHERE campaign_id = $1 AND status = 'pending' AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id LIMIT ${ENQUEUE_BATCH}`,
      [campaignId, lastId],
    );
    if (!batch.length) break;
    await campaignMessageQueue.addBulk(
      batch.map((r) => ({ name: 'send', data: { recipientId: r.id, campaignId }, opts: { jobId: `cr_${r.id}` } })),
    );
    lastId = batch[batch.length - 1].id;
  }

  await notify(campaign.workspaceId, campaignId);
  await finalizeIfDone(campaign.workspaceId, campaignId);
}

async function closeRecipient(row, status, errorCode, errorMessage) {
  await db.exec(
    `UPDATE campaign_recipients SET status = $2, error_code = $3, error_message = $4, updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [row.id, status, errorCode, errorMessage ? String(errorMessage).slice(0, 500) : null],
  );
  await finalizeIfDone(row.workspaceId, row.campaignId);
}

/**
 * Step 2 (campaign message queue): send the template to one recipient.
 * Throwing makes BullMQ retry with backoff; returning normally ends the job.
 */
export async function sendCampaignMessage({ recipientId }, { isLastAttempt = false } = {}) {
  const row = await db.one(
    `SELECT r.id, r.status, r.campaign_id, r.workspace_id,
            c.status AS campaign_status, c.variables, c.template_name, c.template_language,
            ct.id AS contact_id, ct.phone, ct.wa_user_id, ct.name, ct.email, ct.opted_out,
            t.components, t.parameter_format
       FROM campaign_recipients r
       JOIN campaigns c ON c.id = r.campaign_id
       JOIN contacts ct ON ct.id = r.contact_id
       LEFT JOIN templates t ON t.id = c.template_id
      WHERE r.id = $1`,
    [recipientId],
  );
  if (!row || row.status !== 'pending') return; // already handled (retry after success, or cancelled)
  if (row.campaignStatus !== 'sending') return closeRecipient(row, 'skipped', null, 'Campaign was cancelled');
  if (row.optedOut) return closeRecipient(row, 'skipped', null, 'Contact opted out');
  if (!row.components) return closeRecipient(row, 'failed', null, 'The template no longer exists');

  const contact = { id: row.contactId, phone: row.phone, waUserId: row.waUserId, name: row.name, email: row.email };
  let built;
  try {
    built = buildTemplateMessage({ components: row.components, parameterFormat: row.parameterFormat }, row.variables, contact);
  } catch (err) {
    return closeRecipient(row, 'failed', null, err.message);
  }

  const account = await getAccount(row.workspaceId);
  if (!account) return closeRecipient(row, 'failed', null, 'WhatsApp is not connected');

  let response;
  try {
    response = await sendTemplate(account, contact, {
      name: row.templateName,
      language: row.templateLanguage,
      components: built.components,
    });
  } catch (err) {
    if (!(err instanceof WhatsAppError)) throw err;
    if (err.retryable && !isLastAttempt) throw err;
    return closeRecipient(row, 'failed', err.code, err.message);
  }

  const waMessageId = response?.messages?.[0]?.id ?? null;
  const stored = await db.tx(async (t) => {
    const conversation = await ensureConversation(t, row.workspaceId, contact.id);
    const message = await t.one(
      `INSERT INTO messages
         (workspace_id, conversation_id, contact_id, direction, type, body, template_name, wa_message_id,
          status, source, campaign_id, sent_at)
       VALUES ($1, $2, $3, 'out', 'template', $4, $5, $6, 'sent', 'campaign', $7, now())
       RETURNING id`,
      [row.workspaceId, conversation.id, contact.id, built.text, row.templateName, waMessageId, row.campaignId],
    );
    await t.exec(
      `UPDATE campaign_recipients SET status = 'sent', wa_message_id = $2, message_id = $3, updated_at = now()
        WHERE id = $1`,
      [row.id, waMessageId, message.id],
    );
    await touchConversation(t, conversation.id, { preview: previewFor('template', built.text), direction: 'out' });
    return { messageId: message.id, conversationId: conversation.id };
  });

  await rememberUserId(contact, response);
  const [message, conversation] = await Promise.all([
    getMessage(row.workspaceId, stored.messageId),
    getConversation(row.workspaceId, stored.conversationId),
  ]);
  await publish(row.workspaceId, 'message:new', { message, conversation });
  await finalizeIfDone(row.workspaceId, row.campaignId);
}

/** Called when a send job has used up its retries because of an unexpected error. */
export async function failRecipient(recipientId, reason) {
  const row = await db.one('SELECT id, campaign_id, workspace_id FROM campaign_recipients WHERE id = $1', [recipientId]);
  if (row) await closeRecipient(row, 'failed', null, reason);
}

export async function failCampaign(campaignId, reason) {
  const row = await db.one(
    `UPDATE campaigns SET status = 'failed', error_message = $2, completed_at = now()
      WHERE id = $1 AND status = 'queued' RETURNING workspace_id`,
    [campaignId, String(reason).slice(0, 500)],
  );
  if (row) {
    logger.error({ campaignId, reason }, 'Campaign could not be started');
    await notify(row.workspaceId, campaignId);
  }
}

export async function cancelCampaign(workspaceId, campaignId) {
  const row = await db.one(
    `UPDATE campaigns SET status = 'cancelled', completed_at = now()
      WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'sending') RETURNING id`,
    [campaignId, workspaceId],
  );
  if (!row) return false;
  await db.exec(
    `UPDATE campaign_recipients SET status = 'skipped', error_message = 'Campaign was cancelled', updated_at = now()
      WHERE campaign_id = $1 AND status = 'pending'`,
    [campaignId],
  );
  await notify(workspaceId, campaignId);
  return true;
}
