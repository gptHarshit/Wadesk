import { db } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../logger.js';

export const CONTACT_SELECT = `
  SELECT ct.id, ct.name, ct.phone, ct.wa_user_id, ct.wa_username, ct.email, ct.notes, ct.opted_out,
         ct.created_at, ct.updated_at,
         COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name)
                     FROM contact_tags x JOIN tags t ON t.id = x.tag_id
                    WHERE x.contact_id = ct.id), '[]'::json) AS tags
    FROM contacts ct`;

/** Make sure every tag ID belongs to this workspace. Returns the de-duplicated list. */
export async function assertTags(q, workspaceId, tagIds) {
  const unique = [...new Set(tagIds ?? [])];
  if (!unique.length) return [];
  const found = await q.many('SELECT id FROM tags WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [workspaceId, unique]);
  if (found.length !== unique.length) throw badRequest('One or more tags do not exist');
  return unique;
}

export async function setContactTags(q, contactId, tagIds) {
  await q.exec('DELETE FROM contact_tags WHERE contact_id = $1', [contactId]);
  if (tagIds.length) {
    await q.exec(
      `INSERT INTO contact_tags (contact_id, tag_id)
       SELECT $1::uuid, x FROM unnest($2::uuid[]) AS x ON CONFLICT DO NOTHING`,
      [contactId, tagIds],
    );
  }
}

/**
 * Find or create the contact behind an incoming WhatsApp message.
 * Matches on business-scoped user ID first, then phone number, and fills in
 * whichever identifier or profile detail we were missing.
 */
export async function upsertInboundContact(q, workspaceId, { phone, waUserId, username, profileName }) {
  let contact = null;
  if (waUserId) {
    contact = await q.one('SELECT * FROM contacts WHERE workspace_id = $1 AND wa_user_id = $2 FOR UPDATE', [
      workspaceId,
      waUserId,
    ]);
  }
  if (!contact && phone) {
    contact = await q.one('SELECT * FROM contacts WHERE workspace_id = $1 AND phone = $2 FOR UPDATE', [workspaceId, phone]);
  }

  if (!contact) {
    if (!phone && !waUserId) return null;
    return q.one(
      `INSERT INTO contacts (workspace_id, phone, wa_user_id, wa_username, name)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [workspaceId, phone ?? null, waUserId ?? null, username ?? null, profileName ?? null],
    );
  }

  let nextPhone = contact.phone;
  if (!contact.phone && phone) {
    // Only adopt the number if no other contact already owns it.
    const clash = await q.one('SELECT id FROM contacts WHERE workspace_id = $1 AND phone = $2', [workspaceId, phone]);
    if (clash) logger.warn({ workspaceId, contactId: contact.id, clash: clash.id }, 'Phone belongs to another contact; not merged');
    else nextPhone = phone;
  }
  const next = {
    phone: nextPhone,
    waUserId: contact.waUserId ?? waUserId ?? null,
    waUsername: username ?? contact.waUsername,
    name: contact.name ?? profileName ?? null,
  };
  const changed =
    next.phone !== contact.phone ||
    next.waUserId !== contact.waUserId ||
    next.waUsername !== contact.waUsername ||
    next.name !== contact.name;
  if (!changed) return contact;

  return q.one(
    `UPDATE contacts SET phone = $2, wa_user_id = $3, wa_username = $4, name = $5, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [contact.id, next.phone, next.waUserId, next.waUsername, next.name],
  );
}

export const getContact = (workspaceId, id, q = db) =>
  q.one(`${CONTACT_SELECT} WHERE ct.workspace_id = $1 AND ct.id = $2`, [workspaceId, id]);
