/**
 * Pure helpers for WhatsApp message templates: working out which variables a
 * template needs, and building the `components` array the send API expects.
 * No database or network access, so this file is easy to unit test.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
// Contact merge fields allowed inside a variable value, e.g. "{{name|there}}".
const MERGE_FIELD = /\{\{\s*(name|phone|email)\s*(?:\|([^}]*))?\}\}/gi;

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
    .replace(MERGE_FIELD, (_, field, fallback) => {
      const actual = contact?.[field.toLowerCase()];
      return (actual && String(actual).trim()) || (fallback ?? '').trim();
    })
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
