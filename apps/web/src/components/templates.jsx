'use client';

import { useEffect, useMemo, useState } from 'react';
import { LuExternalLink, LuFile, LuImage, LuReply, LuSearch, LuVideo } from 'react-icons/lu';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Badge, Button, EmptyState, ErrorBlock, Input, LoadingBlock, Modal, cx, useFeedback } from './ui';

export const emptyVariables = () => ({ header: { text: {} }, body: {}, buttons: {} });

const STATUS_TONES = { APPROVED: 'green', PENDING: 'amber', REJECTED: 'red', PAUSED: 'amber', DISABLED: 'red' };

export function TemplateStatus({ status }) {
  const label = String(status || 'unknown').toLowerCase().replace(/_/g, ' ');
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{label.charAt(0).toUpperCase() + label.slice(1)}</Badge>;
}

/** Swap contact merge fields ({{name|there}}) for a sample contact, for previews. */
function previewValue(value, contact) {
  return String(value ?? '').replace(/\{\{\s*(name|phone|email)\s*(?:\|([^}]*))?\}\}/gi, (_, field, fallback) => {
    return contact?.[field.toLowerCase()] || (fallback ?? '').trim() || `{{${field}}}`;
  });
}

function fill(text, values, contact) {
  return String(text ?? '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, key) => {
    const value = previewValue(values?.[key], contact);
    return value || whole;
  });
}

const MEDIA_ICONS = { IMAGE: LuImage, VIDEO: LuVideo, DOCUMENT: LuFile };

/** How the message will look in WhatsApp, with the current variable values filled in. */
export function TemplatePreview({ template, variables, contact, className }) {
  const info = template.info;
  const HeaderIcon = info.header ? MEDIA_ICONS[info.header.format] : null;
  return (
    <div className={cx('thread-surface rounded-lg p-4', className)}>
      <div className="ml-auto max-w-sm rounded-2xl rounded-br-sm bg-leaf-100 px-3.5 py-2.5 text-mist-900 shadow-sm">
        {info.header?.format === 'TEXT' ? (
          <p className="mb-1 font-semibold">{fill(info.header.text, variables?.header?.text, contact)}</p>
        ) : HeaderIcon ? (
          <div className="mb-2 flex h-24 items-center justify-center gap-2 rounded-lg bg-leaf-200/70 text-sm text-leaf-800">
            <HeaderIcon className="h-5 w-5" aria-hidden />
            {info.header.format.toLowerCase()} header
          </div>
        ) : null}
        <p className="whitespace-pre-wrap leading-snug">{fill(info.body.text, variables?.body, contact)}</p>
        {info.footer ? <p className="mt-1.5 text-sm text-mist-500">{info.footer}</p> : null}
        {info.buttons.length ? (
          <div className="mt-2 divide-y divide-leaf-200 border-t border-leaf-200">
            {info.buttons.map((button) => (
              <p key={button.index} className="flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium text-sky-700">
                {button.type === 'URL' ? <LuExternalLink className="h-3.5 w-3.5" aria-hidden /> : <LuReply className="h-3.5 w-3.5" aria-hidden />}
                {button.text}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function templateHasVariables(info) {
  return Boolean(
    info.body.params.length || info.header?.params.length || (info.header && info.header.format !== 'TEXT') || info.buttons.some((b) => b.needsParam),
  );
}

/** Inputs for every variable a template needs. `value` has the shape the API expects. */
export function TemplateVariablesForm({ template, value, onChange, mergeFields = true }) {
  const info = template.info;
  const setHeaderText = (key, v) => onChange({ ...value, header: { ...value.header, text: { ...value.header?.text, [key]: v } } });
  const setHeader = (key, v) => onChange({ ...value, header: { ...value.header, [key]: v } });
  const setBody = (key, v) => onChange({ ...value, body: { ...value.body, [key]: v } });
  const setButton = (key, v) => onChange({ ...value, buttons: { ...value.buttons, [key]: v } });

  if (!templateHasVariables(info)) {
    return <p className="text-mist-600">This template has no variables. It will be sent exactly as shown.</p>;
  }
  const nameHint = mergeFields ? 'Type {{name|there}} to insert each contact’s name, with “there” used when no name is saved.' : undefined;

  return (
    <div className="space-y-3">
      {info.header?.format === 'TEXT'
        ? info.header.params.map((key) => (
            <Input key={`h${key}`} label={`Header {{${key}}}`} value={value.header?.text?.[key] ?? ''} onChange={(e) => setHeaderText(key, e.target.value)} />
          ))
        : null}
      {info.header && info.header.format !== 'TEXT' ? (
        <>
          <Input
            label={`Header ${info.header.format.toLowerCase()} link`}
            type="url"
            placeholder="https://"
            value={value.header?.link ?? ''}
            onChange={(e) => setHeader('link', e.target.value)}
            hint="A public https link. WhatsApp downloads the file from here when sending."
          />
          {info.header.format === 'DOCUMENT' ? (
            <Input label="File name shown to the customer" value={value.header?.filename ?? ''} onChange={(e) => setHeader('filename', e.target.value)} />
          ) : null}
        </>
      ) : null}
      {info.body.params.map((key, index) => (
        <Input
          key={`b${key}`}
          label={`Message {{${key}}}`}
          value={value.body?.[key] ?? ''}
          onChange={(e) => setBody(key, e.target.value)}
          hint={index === 0 ? nameHint : undefined}
        />
      ))}
      {info.buttons
        .filter((b) => b.needsParam)
        .map((button) => (
          <Input
            key={`btn${button.index}`}
            label={`Link ending for the “${button.text}” button`}
            value={value.buttons?.[String(button.index)] ?? ''}
            onChange={(e) => setButton(String(button.index), e.target.value)}
            hint={`Replaces {{1}} in ${button.url}`}
          />
        ))}
    </div>
  );
}

/** Pick an approved template, fill its variables, and send it into one conversation. */
export function SendTemplateDialog({ open, onClose, conversation, onSent }) {
  const { toast } = useFeedback();
  const { data, error, loading, reload } = useApi(open ? '/templates' : null, { status: 'APPROVED' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [variables, setVariables] = useState(emptyVariables);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setSearch('');
      setVariables(emptyVariables());
    }
  }, [open]);

  const templates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.items ?? []).filter((t) => !term || t.name.toLowerCase().includes(term) || t.info.body.text.toLowerCase().includes(term));
  }, [data, search]);

  async function send() {
    setSending(true);
    try {
      const result = await api(`/conversations/${conversation.id}/template`, {
        method: 'POST',
        body: { templateId: selected.id, variables },
      });
      onSent?.(result);
      if (result.message.status === 'failed') toast.error(result.message.errorMessage || 'WhatsApp rejected this message');
      else toast.success('Template sent');
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={selected ? selected.name : 'Send a template'}
      description={selected ? undefined : 'Templates are the only messages WhatsApp allows outside the 24-hour reply window.'}
      footer={
        selected ? (
          <>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Back
            </Button>
            <Button onClick={send} loading={sending} disabled={!selected.info.sendable}>
              Send template
            </Button>
          </>
        ) : null
      }
    >
      {selected ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            {selected.info.sendable ? (
              <TemplateVariablesForm template={selected} value={variables} onChange={setVariables} />
            ) : (
              <p className="text-brick-700">{selected.info.reason}</p>
            )}
          </div>
          <TemplatePreview template={selected} variables={variables} contact={conversation?.contact} />
        </div>
      ) : loading ? (
        <LoadingBlock label="Loading templates" />
      ) : error ? (
        <ErrorBlock error={error} onRetry={reload} />
      ) : !data?.items.length ? (
        <EmptyState title="No approved templates yet">
          Create templates in WhatsApp Manager, then press “Sync from WhatsApp” on the Templates page.
        </EmptyState>
      ) : (
        <>
          <div className="relative mb-3">
            <LuSearch className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-mist-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates"
              aria-label="Search templates"
              className="h-10 w-full rounded-md border border-mist-300 bg-white pl-9 pr-3 placeholder:text-mist-400 focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/20"
            />
          </div>
          <ul className="divide-y divide-mist-100">
            {templates.map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(template);
                    setVariables(emptyVariables());
                  }}
                  className="block w-full rounded-md px-2 py-2.5 text-left hover:bg-mist-50"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-mist-900">{template.name}</span>
                    <span className="text-sm text-mist-500">{template.language}</span>
                    {template.category ? <Badge>{template.category.toLowerCase()}</Badge> : null}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-sm text-mist-600">{template.info.body.text}</span>
                </button>
              </li>
            ))}
            {!templates.length ? <li className="py-6 text-center text-mist-500">No templates match “{search}”.</li> : null}
          </ul>
        </>
      )}
    </Modal>
  );
}
