import { parse as parseCsv } from 'csv-parse/sync';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { email, idParam, limit, nullableText, page, parse, uuid } from '../lib/validate.js';
import { requireAuth, requireManager } from '../middleware/auth.js';
import { CONTACT_SELECT, assertTags, getContact, setContactTags } from '../services/contacts.js';
import { MAX_FIELD_KEYS, MAX_FIELD_VALUE, normalizeFieldKey, sanitizeAttributes } from '../services/templates.js';

export const contactsRouter = Router();
export const tagsRouter = Router();
contactsRouter.use(requireAuth);
tagsRouter.use(requireAuth);

const MAX_IMPORT_ROWS = 50_000;
const IMPORT_CHUNK = 500;
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const likePattern = (term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

async function defaultCountryCode(workspaceId) {
  const row = await db.one('SELECT default_country_code FROM workspaces WHERE id = $1', [workspaceId]);
  return row?.defaultCountryCode ?? null;
}

// Custom fields: { "marks": "92", "department": "Sales" }. Keys are normalised to lower_snake_case.
const attributesSchema = z
  .record(z.union([z.string().max(MAX_FIELD_VALUE), z.number(), z.null()]))
  .optional()
  .transform((v) => (v === undefined ? undefined : sanitizeAttributes(v)));

const optionalEmail = z
  .union([email, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));

/* ---------------------------------- Contacts ---------------------------------- */

contactsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(
      z.object({
        search: z.string().trim().max(100).optional(),
        tagId: uuid.optional(),
        page,
        limit: limit(100, 25),
      }),
      req.query,
    );
    const where = ['ct.workspace_id = $1'];
    const params = [req.user.workspaceId];
    if (q.search) {
      params.push(likePattern(q.search));
      const text = `$${params.length}`;
      const conditions = [`ct.name ILIKE ${text}`, `ct.email ILIKE ${text}`, `ct.wa_username ILIKE ${text}`];
      // Phones are stored as digits only, so "+91 98765" should still match.
      const digits = q.search.replace(/\D/g, '');
      if (digits.length >= 3) {
        params.push(`%${digits}%`);
        conditions.push(`ct.phone LIKE $${params.length}`);
      }
      where.push(`(${conditions.join(' OR ')})`);
    }
    if (q.tagId) {
      params.push(q.tagId);
      where.push(`EXISTS (SELECT 1 FROM contact_tags x WHERE x.contact_id = ct.id AND x.tag_id = $${params.length})`);
    }
    const whereSql = where.join(' AND ');

    const [{ total }, items] = await Promise.all([
      db.one(`SELECT count(*)::int AS total FROM contacts ct WHERE ${whereSql}`, params),
      db.many(
        `${CONTACT_SELECT} WHERE ${whereSql}
          ORDER BY ct.created_at DESC, ct.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.limit, (q.page - 1) * q.limit],
      ),
    ]);
    res.json({ items, total, page: q.page, limit: q.limit });
  }),
);

contactsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        name: nullableText(120),
        phone: z.string({ required_error: 'Phone number is required' }).trim().min(1, 'Phone number is required').max(30),
        email: optionalEmail,
        notes: nullableText(2000),
        tagIds: z.array(uuid).max(50).default([]),
        attributes: attributesSchema,
      }),
      req.body,
    );
    const phone = normalizePhone(body.phone, await defaultCountryCode(req.user.workspaceId));
    if (!phone) throw badRequest('Enter a valid phone number with country code, for example +91 98765 43210');

    const id = await db.tx(async (t) => {
      const tagIds = await assertTags(t, req.user.workspaceId, body.tagIds);
      if (await t.one('SELECT id FROM contacts WHERE workspace_id = $1 AND phone = $2', [req.user.workspaceId, phone])) {
        throw conflict('A contact with this phone number already exists');
      }
      const row = await t.one(
        `INSERT INTO contacts (workspace_id, phone, name, email, notes, attributes)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
        [req.user.workspaceId, phone, body.name ?? null, body.email ?? null, body.notes ?? null, JSON.stringify(body.attributes ?? {})],
      );
      await setContactTags(t, row.id, tagIds);
      return row.id;
    });
    res.status(201).json(await getContact(req.user.workspaceId, id));
  }),
);

/** Every custom field used in this workspace, with how many contacts have it. */
contactsRouter.get(
  '/fields',
  asyncHandler(async (req, res) => {
    const items = await db.many(
      `SELECT k AS key, count(*)::int AS contact_count
         FROM contacts ct, jsonb_object_keys(ct.attributes) AS k
        WHERE ct.workspace_id = $1
        GROUP BY k ORDER BY k`,
      [req.user.workspaceId],
    );
    res.json({ items });
  }),
);

contactsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const contact = await getContact(req.user.workspaceId, id);
    if (!contact) throw notFound('Contact');
    const conversation = await db.one('SELECT id FROM conversations WHERE workspace_id = $1 AND contact_id = $2', [
      req.user.workspaceId,
      id,
    ]);
    res.json({ ...contact, conversationId: conversation?.id ?? null });
  }),
);

contactsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        name: nullableText(120),
        phone: z.string().trim().min(1).max(30).optional(),
        email: optionalEmail,
        notes: nullableText(2000),
        optedOut: z.boolean().optional(),
        tagIds: z.array(uuid).max(50).optional(),
        // Replaces all custom fields; send the full set.
        attributes: attributesSchema,
      }),
      req.body,
    );
    const existing = await db.one('SELECT id, phone, name, email, notes, opted_out, attributes FROM contacts WHERE workspace_id = $1 AND id = $2', [
      req.user.workspaceId,
      id,
    ]);
    if (!existing) throw notFound('Contact');

    let phone = existing.phone;
    if (body.phone !== undefined) {
      phone = normalizePhone(body.phone, await defaultCountryCode(req.user.workspaceId));
      if (!phone) throw badRequest('Enter a valid phone number with country code, for example +91 98765 43210');
    }

    await db.tx(async (t) => {
      if (phone !== existing.phone) {
        const clash = await t.one('SELECT id FROM contacts WHERE workspace_id = $1 AND phone = $2 AND id <> $3', [
          req.user.workspaceId,
          phone,
          id,
        ]);
        if (clash) throw conflict('Another contact already has this phone number');
      }
      await t.exec(
        `UPDATE contacts SET phone = $2, name = $3, email = $4, notes = $5, opted_out = $6, attributes = $7::jsonb,
                updated_at = now()
          WHERE id = $1`,
        [
          id,
          phone,
          body.name === undefined ? existing.name : body.name,
          body.email === undefined ? existing.email : body.email,
          body.notes === undefined ? existing.notes : body.notes,
          body.optedOut ?? existing.optedOut,
          JSON.stringify(body.attributes === undefined ? existing.attributes ?? {} : body.attributes),
        ],
      );
      if (body.tagIds) await setContactTags(t, id, await assertTags(t, req.user.workspaceId, body.tagIds));
    });
    res.json(await getContact(req.user.workspaceId, id));
  }),
);

contactsRouter.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const deleted = await db.exec('DELETE FROM contacts WHERE workspace_id = $1 AND id = $2', [req.user.workspaceId, id]);
    if (!deleted) throw notFound('Contact');
    res.json({ ok: true });
  }),
);

/* --------------------------------- CSV import --------------------------------- */

const PHONE_HEADERS = ['phone', 'mobile', 'number', 'phone number', 'phone_number', 'whatsapp', 'whatsapp number', 'contact'];
const NAME_HEADERS = ['name', 'full name', 'full_name', 'customer', 'customer name'];
const EMAIL_HEADERS = ['email', 'e-mail', 'email address'];
const TAG_HEADERS = ['tags', 'tag', 'labels'];
const pick = (record, headers) => {
  for (const h of headers) if (record[h] !== undefined && String(record[h]).trim() !== '') return String(record[h]).trim();
  return '';
};

const KNOWN_HEADERS = new Set([...PHONE_HEADERS, ...NAME_HEADERS, ...EMAIL_HEADERS, ...TAG_HEADERS]);

/**
 * Import contacts from a CSV with a header row. Needs a phone column; name,
 * email and tags (separated by ";" or "|") are optional. Every other column is
 * saved as a custom field (e.g. "Father Name" -> father_name) that campaigns can
 * merge into templates. Existing contacts are updated, never duplicated.
 */
contactsRouter.post(
  '/import',
  requireManager,
  csvUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Choose a CSV file to import');
    const extra = parse(
      z.object({
        tagIds: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
          .pipe(z.array(uuid).max(20)),
      }),
      req.body ?? {},
    );
    const workspaceId = req.user.workspaceId;
    const fixedTagIds = await assertTags(db, workspaceId, extra.tagIds);

    let records;
    let headers = [];
    try {
      records = parseCsv(req.file.buffer.toString('utf8'), {
        bom: true,
        columns: (header) => {
          headers = header.map((h) => String(h).trim().toLowerCase());
          return headers;
        },
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (err) {
      throw badRequest(`Could not read this CSV: ${err.message}`);
    }
    if (!records.length) throw badRequest('The file has no rows');
    if (records.length > MAX_IMPORT_ROWS) throw badRequest(`A file can have at most ${MAX_IMPORT_ROWS.toLocaleString()} rows`);
    if (!PHONE_HEADERS.some((h) => h in records[0])) {
      throw badRequest('The file needs a column named "phone" (plus optional "name", "email", "tags" and any other columns)');
    }

    // Every other column becomes a custom field.
    const fieldColumns = []; // [{ header, key }]
    for (const header of headers) {
      if (!header || KNOWN_HEADERS.has(header)) continue;
      const key = normalizeFieldKey(header);
      if (!key || ['name', 'phone', 'email'].includes(key) || fieldColumns.some((c) => c.key === key)) continue;
      if (fieldColumns.length >= MAX_FIELD_KEYS) break;
      fieldColumns.push({ header, key });
    }

    const countryCode = await defaultCountryCode(workspaceId);
    const rows = new Map(); // phone -> row; a number repeated in the file keeps its first row
    const errors = [];
    let invalid = 0;
    records.forEach((record, index) => {
      const rawPhone = pick(record, PHONE_HEADERS);
      const phone = normalizePhone(rawPhone, countryCode);
      if (!phone) {
        invalid += 1;
        if (errors.length < 20) errors.push({ row: index + 2, reason: rawPhone ? `Invalid phone number "${rawPhone}"` : 'Missing phone number' });
        return;
      }
      const tags = pick(record, TAG_HEADERS)
        .split(/[;|]/)
        .map((t) => t.trim().slice(0, 40))
        .filter(Boolean);
      const earlier = rows.get(phone);
      if (earlier) {
        earlier.tags.push(...tags); // still pick up any extra tags from the repeated row
        return;
      }
      const rawEmail = pick(record, EMAIL_HEADERS).toLowerCase();
      const attributes = {};
      for (const { header, key } of fieldColumns) {
        const value = String(record[header] ?? '').trim();
        if (value) attributes[key] = value.slice(0, MAX_FIELD_VALUE);
      }
      rows.set(phone, {
        phone,
        name: pick(record, NAME_HEADERS).slice(0, 120),
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail.slice(0, 254) : '',
        tags,
        attributes,
      });
    });

    const list = [...rows.values()];
    const result = await db.tx(async (t) => {
      // Create any tags named in the file that don't exist yet.
      const tagNames = [...new Map(list.flatMap((r) => r.tags).map((n) => [n.toLowerCase(), n])).values()];
      const tagIdByName = new Map();
      if (tagNames.length) {
        await t.exec(
          `INSERT INTO tags (workspace_id, name)
           SELECT $1::uuid, x FROM unnest($2::text[]) AS x
           ON CONFLICT (workspace_id, lower(name)) DO NOTHING`,
          [workspaceId, tagNames],
        );
        const tags = await t.many('SELECT id, name FROM tags WHERE workspace_id = $1 AND lower(name) = ANY($2::text[])', [
          workspaceId,
          tagNames.map((n) => n.toLowerCase()),
        ]);
        for (const tag of tags) tagIdByName.set(tag.name.toLowerCase(), tag.id);
      }

      let created = 0;
      let updated = 0;
      for (let i = 0; i < list.length; i += IMPORT_CHUNK) {
        const chunk = list.slice(i, i + IMPORT_CHUNK);
        const saved = await t.many(
          `INSERT INTO contacts (workspace_id, phone, name, email, attributes)
           SELECT $1::uuid, x.phone, NULLIF(x.name, ''), NULLIF(x.email, ''), COALESCE(x.attributes, '{}'::jsonb)
             FROM jsonb_to_recordset($2::jsonb) AS x(phone text, name text, email text, attributes jsonb)
           ON CONFLICT (workspace_id, phone) WHERE phone IS NOT NULL DO UPDATE
             SET name = COALESCE(EXCLUDED.name, contacts.name),
                 email = COALESCE(EXCLUDED.email, contacts.email),
                 -- New values win; fields not in this file are kept.
                 attributes = contacts.attributes || EXCLUDED.attributes,
                 updated_at = now()
           RETURNING id, phone, (xmax = 0) AS inserted`,
          [
            workspaceId,
            JSON.stringify(chunk.map((r) => ({ phone: r.phone, name: r.name, email: r.email, attributes: r.attributes }))),
          ],
        );
        const idByPhone = new Map(saved.map((s) => [s.phone, s.id]));
        created += saved.filter((s) => s.inserted).length;
        updated += saved.filter((s) => !s.inserted).length;

        const contactIds = [];
        const tagIds = [];
        for (const row of chunk) {
          const contactId = idByPhone.get(row.phone);
          const ids = new Set([...fixedTagIds, ...row.tags.map((n) => tagIdByName.get(n.toLowerCase())).filter(Boolean)]);
          for (const tagId of ids) {
            contactIds.push(contactId);
            tagIds.push(tagId);
          }
        }
        if (contactIds.length) {
          await t.exec(
            `INSERT INTO contact_tags (contact_id, tag_id)
             SELECT * FROM unnest($1::uuid[], $2::uuid[]) ON CONFLICT DO NOTHING`,
            [contactIds, tagIds],
          );
        }
      }
      return { created, updated };
    });

    res.json({
      ...result,
      invalid,
      duplicatesInFile: records.length - invalid - list.length,
      totalRows: records.length,
      fields: fieldColumns.map((c) => c.key),
      errors,
    });
  }),
);

/* ------------------------------------ Tags ------------------------------------ */

const TAG_COLORS = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];
const tagBody = z.object({
  name: z.string().trim().min(1, 'Tag name is required').max(40),
  color: z.enum(TAG_COLORS).default('slate'),
});

tagsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await db.many(
      `SELECT t.id, t.name, t.color, t.created_at,
              (SELECT count(*)::int FROM contact_tags x WHERE x.tag_id = t.id) AS contact_count
         FROM tags t WHERE t.workspace_id = $1 ORDER BY lower(t.name)`,
      [req.user.workspaceId],
    );
    res.json({ items });
  }),
);

tagsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(tagBody, req.body);
    try {
      const tag = await db.one(
        'INSERT INTO tags (workspace_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color, created_at',
        [req.user.workspaceId, body.name, body.color],
      );
      res.status(201).json({ ...tag, contactCount: 0 });
    } catch (err) {
      if (err.code === '23505') throw conflict('A tag with this name already exists');
      throw err;
    }
  }),
);

tagsRouter.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(tagBody.partial(), req.body);
    try {
      const tag = await db.one(
        `UPDATE tags SET name = COALESCE($3, name), color = COALESCE($4, color)
          WHERE workspace_id = $1 AND id = $2 RETURNING id, name, color, created_at`,
        [req.user.workspaceId, id, body.name ?? null, body.color ?? null],
      );
      if (!tag) throw notFound('Tag');
      res.json(tag);
    } catch (err) {
      if (err.code === '23505') throw conflict('A tag with this name already exists');
      throw err;
    }
  }),
);

tagsRouter.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const deleted = await db.exec('DELETE FROM tags WHERE workspace_id = $1 AND id = $2', [req.user.workspaceId, id]);
    if (!deleted) throw notFound('Tag');
    res.json({ ok: true });
  }),
);
