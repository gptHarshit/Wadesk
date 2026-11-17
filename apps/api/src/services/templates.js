/**
 * Pure helpers for WhatsApp message templates: working out which variables a
 * template needs, and building the `components` array the send API expects.
 * No database or network access, so this file is easy to unit test.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
// Contact merge fields allowed inside a variable value, e.g. "{{name|there}}" or "{{marks}}".
// Built-in fields are name, phone and email; any other key is looked up in the contact's custom fields.
const MERGE_FIELD = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|([^}]*))?\}\}/g;
const BUILT_IN_FIELDS = ['name', 'phone', 'email'];
export const MAX_FIELD_KEYS = 50;
export const MAX_FIELD_VALUE = 500;

/**
 * Turn a column header or field name into the key used for custom fields:
 * "Father Name" -> "father_name", "Due Amount (Rs)" -> "due_amount_rs". Returns '' if nothing usable is left.
 */
export function normalizeFieldKey(raw) {
  let key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (key && /^[0-9]/.test(key)) key = `f_${key}`;
  return key;
}

/** Clean a custom-fields object: normalised keys, text values, empty values dropped, size-limited. */
export function sanitizeAttributes(input) {
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(input && typeof input === 'object' ? input : {})) {
    const key = normalizeFieldKey(rawKey);
    if (!key || BUILT_IN_FIELDS.includes(key)) continue;
    if (rawValue === null || rawValue === undefined || typeof rawValue === 'object') continue;
    const value = String(rawValue).trim().slice(0, MAX_FIELD_VALUE);
    if (!value) continue;
    if (!(key in out) && Object.keys(out).length >= MAX_FIELD_KEYS) continue;
    out[key] = value;
  }
  return out;
}

/** The merge-field keys used across a campaign's variable values, e.g. ["name", "marks"]. */
export function mergeFieldsUsed(variables) {
  const keys = new Set();
  const scan = (value) => {
    for (const match of String(value ?? '').matchAll(MERGE_FIELD)) keys.add(match[1].toLowerCase());
  };
  const vars = variables ?? {};
  Object.values(vars.header?.text ?? {}).forEach(scan);
  Object.values(vars.body ?? {}).forEach(scan);
  Object.values(vars.buttons ?? {}).forEach(scan);
  return [...keys];
}

/** Merge fields in `value` that this contact has no data for and that have no "|fallback". */
export function missingFields(value, contact) {
  const missing = [];
  for (const match of String(value ?? '').matchAll(MERGE_FIELD)) {
    const key = match[1].toLowerCase();
    const hasFallback = match[2] !== undefined && match[2].trim() !== '';
    if (!hasFallback && !fieldValue(contact, key) && !missing.includes(key)) missing.push(key);
  }
  return missing;
}

function fieldValue(contact, key) {
  const k = key.toLowerCase();
  if (contact?.sample) return `[${k}]`; // validation/preview stand-in: every field "has" a value
  const raw = BUILT_IN_FIELDS.includes(k) ? contact?.[k] : contact?.attributes?.[k];
  return raw === null || raw === undefined ? '' : String(raw).trim();
}

const find = (components, type) => (components ?? []).find((c) => String(c.type).toUpperCase() === type);

export function placeholders(text) {
  const keys = [];
  for (const match of String(text ?? '').matchAll(PLACEHOLDER)) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

/**
 * Describe what a template needs in order to be sent:
 * { header: {format, params} | null, body: {text, params}, footer, buttons: [{index,type,text,needsParam}], sendable, reason }
 */
export function describeTemplate(template) {
  const components = template.components ?? [];
  const header = find(components, 'HEADER');
  const body = find(components, 'BODY');
  const footer = find(components, 'FOOTER');
  const buttons = find(components, 'BUTTONS')?.buttons ?? [];

  let reason = null;
  const buttonInfo = buttons.map((b, index) => {
    const type = String(b.type).toUpperCase();
    const needsParam = type === 'URL' && placeholders(b.url).length > 0;
    if (['OTP', 'COPY_CODE', 'FLOW', 'CATALOG', 'MPM'].includes(type)) {
      reason = `Templates with ${type.replace('_', ' ').toLowerCase()} buttons can't be sent from this panel yet`;
    }
    return { index, type, text: b.text ?? '', url: b.url ?? null, needsParam };
  });

  let headerInfo = null;
  if (header) {
    const format = String(header.format ?? 'TEXT').toUpperCase();
    if (format === 'LOCATION') reason = "Templates with a location header can't be sent from this panel yet";
    headerInfo = { format, text: header.text ?? null, params: format === 'TEXT' ? placeholders(header.text) : [] };
  }

  return {
    header: headerInfo,
    body: { text: body?.text ?? '', params: placeholders(body?.text) },
    footer: footer?.text ?? null,
    buttons: buttonInfo,
    sendable: reason === null,
    reason,
  };
}

/** Replace contact merge fields in one variable value. */
export function resolveValue(value, contact) {
  return String(value ?? '')
    .replace(MERGE_FIELD, (_, field, fallback) => fieldValue(contact, field) || (fallback ?? '').trim())
    .trim();
}

const textParam = (text, key, named) => ({ type: 'text', ...(named ? { parameter_name: key } : {}), text });

/**
 * Build the send-API components for one contact.
 *
 * `variables` shape:
 *   { header: { text: { "1": "..." } } | { link: "https://...", filename },
 *     body: { "1": "Hi {{name|there}}", "2": "..." },
 *     buttons: { "0": "order-123" } }
 *
 * Returns { components, text } where `text` is the rendered body for the inbox.
 * Throws an Error with a readable message when a required variable is missing.
 */
export function buildTemplateMessage(template, variables, contact) {
  const info = describeTemplate(template);
  if (!info.sendable) throw new Error(info.reason);
  // Named templates use {{first_name}} style placeholders and need parameter_name on each value.
  const named =
    String(template.parameterFormat ?? template.parameter_format ?? '').toUpperCase() === 'NAMED' ||
    [...(info.header?.params ?? []), ...info.body.params].some((key) => !/^\d+$/.test(key));
  const vars = variables ?? {};
  const components = [];

  const need = (value, label) => {
    // A field with no data would leave a gap in the message ("scored  marks"), so treat it as an error.
    const missing = missingFields(value, contact);
    if (missing.length) throw new Error(`No ${missing.join(', ')} saved for this contact`);
    const resolved = resolveValue(value, contact);
    if (!resolved) throw new Error(`Template variable ${label} is empty for this contact`);
    return resolved;
  };

  let renderedHeader = null;
  if (info.header) {
    const { format, params } = info.header;
    if (format === 'TEXT') {
      renderedHeader = info.header.text;
      if (params.length) {
        const values = params.map((key) => need(vars.header?.text?.[key], `header {{${key}}}`));
        components.push({ type: 'header', parameters: params.map((key, i) => textParam(values[i], key, named)) });
        params.forEach((key, i) => {
          renderedHeader = renderedHeader.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), values[i]);
        });
      }
    } else {
      const link = String(vars.header?.link ?? '').trim();
      if (!/^https:\/\/\S+$/i.test(link)) {
        throw new Error(`This template needs a public https link to the header ${format.toLowerCase()}`);
      }
      const kind = format.toLowerCase(); // image | video | document
      const media = { link };
      if (kind === 'document' && vars.header?.filename) media.filename = String(vars.header.filename);
      components.push({ type: 'header', parameters: [{ type: kind, [kind]: media }] });
    }
  }

  let text = info.body.text;
  if (info.body.params.length) {
    const values = info.body.params.map((key) => need(vars.body?.[key], `{{${key}}}`));
    components.push({ type: 'body', parameters: info.body.params.map((key, i) => textParam(values[i], key, named)) });
    info.body.params.forEach((key, i) => {
      text = text.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), values[i]);
    });
  }

  for (const button of info.buttons) {
    if (!button.needsParam) continue;
    const value = need(vars.buttons?.[String(button.index)], `for button "${button.text}"`);
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(button.index),
      parameters: [{ type: 'text', text: value }],
    });
  }

  return { components, text: [renderedHeader, text].filter(Boolean).join('\n\n') };
}

/** Shape stored in campaigns.variables and accepted from the API. */
export function sanitizeVariables(input) {
  const clean = (obj) =>
    Object.fromEntries(
      Object.entries(obj && typeof obj === 'object' ? obj : {})
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 1024)]),
    );
  const header = input?.header && typeof input.header === 'object' ? input.header : {};
  return {
    header: {
      text: clean(header.text),
      ...(typeof header.link === 'string' ? { link: header.link.trim().slice(0, 2000) } : {}),
      ...(typeof header.filename === 'string' ? { filename: header.filename.trim().slice(0, 240) } : {}),
    },
    body: clean(input?.body),
    buttons: clean(input?.buttons),
  };
}
