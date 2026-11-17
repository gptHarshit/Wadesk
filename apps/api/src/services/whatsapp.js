import { config } from '../config.js';
import { db } from '../db.js';
import { decrypt } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';

/**
 * Thin client for the WhatsApp Cloud API (Meta Graph API).
 * `account` is { phoneNumberId, wabaId, accessToken } with the token in plain text.
 */

// Meta error codes that are worth retrying (rate limits and temporary outages).
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131056, 133004, 133015]);

export class WhatsAppError extends Error {
  constructor(message, { status = 0, code = null, subcode = null, retryable = false } = {}) {
    super(message);
    this.name = 'WhatsAppError';
    this.status = status;
    this.code = code === null || code === undefined ? null : String(code);
    this.subcode = subcode;
    this.retryable = retryable;
  }
}

async function graph(account, path, { method = 'GET', query, json, form, timeoutMs = 20_000 } = {}) {
  const url = new URL(`${config.metaGraphBaseUrl}/${config.metaGraphVersion}/${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const headers = { Authorization: `Bearer ${account.accessToken}` };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // fetch sets the multipart boundary itself
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new WhatsAppError(`Could not reach WhatsApp: ${err.message}`, { retryable: true });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }

  if (!res.ok || data?.error) {
    const e = data?.error ?? {};
    const detail = e.error_data?.details;
    const message = [e.message ?? `WhatsApp API returned HTTP ${res.status}`, detail && detail !== e.message ? detail : null]
      .filter(Boolean)
      .join(' — ');
    throw new WhatsAppError(message, {
      status: res.status,
      code: e.code,
      subcode: e.error_subcode ?? null,
      retryable: res.status >= 500 || res.status === 429 || RETRYABLE_CODES.has(Number(e.code)),
    });
  }
  return data;
}

/** Address a contact by phone number when we have it, otherwise by business-scoped user ID. */
export function recipientFields(contact) {
  if (contact.phone) return { to: contact.phone };
  if (contact.waUserId) return { recipient: contact.waUserId };
  throw new WhatsAppError('This contact has no phone number or WhatsApp user ID');
}

function sendMessage(account, contact, payload) {
  return graph(account, `${account.phoneNumberId}/messages`, {
    method: 'POST',
    json: { messaging_product: 'whatsapp', recipient_type: 'individual', ...recipientFields(contact), ...payload },
  });
}

export const sendText = (account, contact, text) =>
  sendMessage(account, contact, { type: 'text', text: { body: text, preview_url: /https?:\/\//i.test(text) } });

/** `kind` is image | document | video | audio. */
export function sendMedia(account, contact, kind, mediaId, { caption, filename } = {}) {
  const media = { id: mediaId };
  if (caption && kind !== 'audio') media.caption = caption;
  if (filename && kind === 'document') media.filename = filename;
  return sendMessage(account, contact, { type: kind, [kind]: media });
}

export const sendTemplate = (account, contact, { name, language, components }) =>
  sendMessage(account, contact, {
    type: 'template',
    template: { name, language: { code: language }, ...(components?.length ? { components } : {}) },
  });

export const markAsRead = (account, waMessageId) =>
  graph(account, `${account.phoneNumberId}/messages`, {
    method: 'POST',
    json: { messaging_product: 'whatsapp', status: 'read', message_id: waMessageId },
  });

export async function uploadMedia(account, buffer, mimeType, filename) {
  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set('type', mimeType);
  form.set('file', new Blob([buffer], { type: mimeType }), filename || 'file');
  const data = await graph(account, `${account.phoneNumberId}/media`, { method: 'POST', form, timeoutMs: 60_000 });
  return data.id;
}

/** Download media a customer sent us. Returns { buffer, mimeType }. */
export async function downloadMedia(account, mediaId, maxBytes) {
  const meta = await graph(account, mediaId);
  if (maxBytes && Number(meta.file_size) > maxBytes) {
    throw new WhatsAppError(`Media is larger than the ${Math.round(maxBytes / 1048576)} MB limit`);
  }
  let res;
  try {
    res = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new WhatsAppError(`Could not download media: ${err.message}`, { retryable: true });
  }
  if (!res.ok) throw new WhatsAppError(`Media download failed with HTTP ${res.status}`, { status: res.status });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (maxBytes && buffer.length > maxBytes) throw new WhatsAppError('Media is larger than the allowed limit');
  return { buffer, mimeType: meta.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream' };
}

/** All message templates on the WhatsApp Business Account (follows pagination). */
export async function fetchTemplates(account) {
  const templates = [];
  let after;
  for (let pageNo = 0; pageNo < 50; pageNo += 1) {
    const data = await graph(account, `${account.wabaId}/message_templates`, {
      query: { limit: 100, after },
    });
    templates.push(...(data.data ?? []));
    after = data.paging?.next ? data.paging?.cursors?.after : undefined;
    if (!after) break;
  }
  return templates;
}

export const fetchPhoneNumber = (account) =>
  graph(account, account.phoneNumberId, { query: { fields: 'id,display_phone_number,verified_name' } });

/** Subscribe our Meta app to the business account so its webhooks are delivered to us. */
export const subscribeApp = (account) => graph(account, `${account.wabaId}/subscribed_apps`, { method: 'POST' });

/** Load and decrypt the workspace's WhatsApp credentials, or null if not connected. */
export async function getAccount(workspaceId) {
  const row = await db.one(
    'SELECT workspace_id, phone_number_id, waba_id, access_token_enc, app_secret_enc FROM whatsapp_accounts WHERE workspace_id = $1',
    [workspaceId],
  );
  if (!row) return null;
  return {
    workspaceId: row.workspaceId,
    phoneNumberId: row.phoneNumberId,
    wabaId: row.wabaId,
    accessToken: decrypt(row.accessTokenEnc),
    appSecret: decrypt(row.appSecretEnc),
  };
}

export async function requireAccount(workspaceId) {
  const account = await getAccount(workspaceId);
  if (!account) {
    throw new HttpError(400, 'whatsapp_not_connected', 'Connect your WhatsApp number in Settings first');
  }
  return account;
}
