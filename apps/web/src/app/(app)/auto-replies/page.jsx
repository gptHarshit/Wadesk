'use client';

import { useEffect, useState } from 'react';
import { LuPencil, LuPlus, LuTrash2, LuZap } from 'react-icons/lu';
import { Badge, Button, EmptyState, ErrorBlock, IconButton, Input, LoadingBlock, Modal, Notice, PageBody, PageHeader, Panel, Select, Table, Textarea, Toggle, useFeedback } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';

const MATCH_LABELS = { contains: 'Message contains', exact: 'Message is exactly', starts_with: 'Message starts with' };
const keywordList = (keyword) => String(keyword ?? '').split(',').map((k) => k.trim()).filter(Boolean);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Monday first on screen; stored Sunday first.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];
const TIME_INPUT =
  'h-9 w-[7.5rem] rounded-md border border-mist-300 bg-surface px-2 tabular-nums text-mist-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-mist-100 disabled:text-mist-400';

/** Away message: answers people who write outside office hours. */
function AwayPanel({ canEdit }) {
  const { toast } = useFeedback();
  const { data, error, loading, reload } = useApi('/auto-replies/away');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const reset = () => {
    setProblem(null);
    setForm({ enabled: data.enabled, message: data.message, timezone: data.timezone, days: data.days.map((d) => ({ ...d })) });
  };
  useEffect(() => {
    if (data) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading && !data) {
    return (
      <Panel className="mb-6">
        <LoadingBlock />
      </Panel>
    );
  }
  if (error && !data) {
    return (
      <Panel className="mb-6">
        <ErrorBlock error={error} onRetry={reload} />
      </Panel>
    );
  }
  if (!form) return null;

  const dirty = JSON.stringify(form) !== JSON.stringify({ enabled: data.enabled, message: data.message, timezone: data.timezone, days: data.days });
  const setDay = (index, changes) => setForm((f) => ({ ...f, days: f.days.map((d, i) => (i === index ? { ...d, ...changes } : d)) }));
  const timezones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];

  async function save(event) {
    event.preventDefault();
    const clash = form.days.findIndex((d) => d.open && d.start === d.end);
    if (clash >= 0) {
      setProblem(`${DAY_NAMES[clash]}: opening and closing time can’t be the same.`);
      return;
    }
    if (form.enabled && !form.message.trim()) {
      setProblem('Write the away message, or turn it off.');
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await api('/auto-replies/away', { method: 'PUT', body: form });
      toast.success(form.enabled ? 'Away message saved' : 'Away message turned off');
      reload({ quiet: true });
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="mb-6 p-5">
      <form onSubmit={save} noValidate>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold text-mist-900">Away message</h2>
            <p className="mt-0.5 max-w-2xl text-mist-600">
              Sent automatically when someone writes outside office hours. Each chat gets it at most once every 12 hours.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={data.enabled ? (data.openNow ? 'green' : 'amber') : 'neutral'}>
              {data.enabled ? (data.openNow ? 'Office open now' : 'Away now') : 'Off'}
            </Badge>
            <Toggle checked={form.enabled} onChange={(enabled) => setForm((f) => ({ ...f, enabled }))} label="Send an away message" disabled={!canEdit} />
          </div>
        </div>

        {form.enabled ? (
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <Textarea
                label="Message"
                rows={4}
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                maxLength={4096}
                disabled={!canEdit}
              />
              <Select label="Time zone" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} disabled={!canEdit}>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz === 'Asia/Kolkata' ? 'India (Asia/Kolkata)' : tz}
                  </option>
                ))}
              </Select>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-mist-800">Office hours</legend>
              <ul className="divide-y divide-mist-100 rounded-md border border-mist-200">
                {DAY_ORDER.map((index) => {
                  const day = form.days[index];
                  return (
                    <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                      <label className="flex w-32 items-center gap-2 text-mist-800">
                        <input
                          type="checkbox"
                          checked={day.open}
                          onChange={(e) => setDay(index, { open: e.target.checked })}
                          disabled={!canEdit}
                          className="h-4 w-4 accent-brand-600"
                        />
                        {DAY_NAMES[index]}
                      </label>
                      {day.open ? (
                        <span className="flex items-center gap-2">
                          <input
                            type="time"
                            value={day.start}
                            onChange={(e) => setDay(index, { start: e.target.value })}
                            disabled={!canEdit}
                            aria-label={`${DAY_NAMES[index]} opens at`}
                            className={TIME_INPUT}
                          />
                          <span className="text-mist-500">to</span>
                          <input
                            type="time"
                            value={day.end}
                            onChange={(e) => setDay(index, { end: e.target.value })}
                            disabled={!canEdit}
                            aria-label={`${DAY_NAMES[index]} closes at`}
                            className={TIME_INPUT}
                          />
                        </span>
                      ) : (
                        <span className="text-sm text-mist-500">Closed all day</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-sm text-mist-500">A closing time earlier than the opening time runs past midnight.</p>
            </fieldset>
          </div>
        ) : data.enabled ? null : (
          <p className="mt-3 text-sm text-mist-500">
            {canEdit ? 'Turn it on to set your office hours.' : 'An owner or admin can turn this on.'} Keyword auto-replies keep working either way.
          </p>
        )}

        {problem ? <Notice tone="red" className="mt-4">{problem}</Notice> : null}
        {canEdit && dirty ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="submit" loading={busy}>
              Save away message
            </Button>
            <Button variant="secondary" onClick={reset} disabled={busy}>
              Discard changes
            </Button>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

function RuleDialog({ open, rule, onClose, onSaved }) {
  const { toast } = useFeedback();
  const [form, setForm] = useState({ keyword: '', matchType: 'contains', replyText: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(rule ? { keyword: rule.keyword, matchType: rule.matchType, replyText: rule.replyText } : { keyword: '', matchType: 'contains', replyText: '' });
  }, [open, rule]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (rule) await api(`/auto-replies/${rule.id}`, { method: 'PATCH', body: form });
      else await api('/auto-replies', { method: 'POST', body: form });
      toast.success(rule ? 'Auto-reply saved' : 'Auto-reply added');
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={rule ? 'Edit auto-reply' : 'New auto-reply'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rule-form" loading={busy}>
            {rule ? 'Save auto-reply' : 'Add auto-reply'}
          </Button>
        </>
      }
    >
      <form id="rule-form" onSubmit={submit} className="space-y-4" noValidate>
        {error ? <Notice tone="red">{error.message}</Notice> : null}
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Select label="When a" value={form.matchType} onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value }))}>
            {Object.entries(MATCH_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Input
            label="Keywords"
            value={form.keyword}
            onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
            placeholder="hi, hello, hey"
            maxLength={500}
            hint="Separate several words with commas. Capital letters don’t matter."
          />
        </div>
        <Textarea
          label="Reply with"
          rows={5}
          value={form.replyText}
          onChange={(e) => setForm((f) => ({ ...f, replyText: e.target.value }))}
          placeholder="Our price list: https://…"
          maxLength={4096}
        />
      </form>
    </Modal>
  );
}

export default function AutoRepliesPage() {
  const { isManager } = useAuth();
  const { toast, confirm } = useFeedback();
  const { data, error, loading, reload, setData } = useApi('/auto-replies');
  const [dialog, setDialog] = useState(null); // { rule } when open

  async function toggle(rule, isActive) {
    // Flip it on screen first; put it back if the save fails.
    setData((d) => ({ items: d.items.map((r) => (r.id === rule.id ? { ...r, isActive } : r)) }));
    try {
      await api(`/auto-replies/${rule.id}`, { method: 'PATCH', body: { isActive } });
    } catch (err) {
      toast.error(err);
      reload({ quiet: true });
    }
  }

  async function remove(rule) {
    const ok = await confirm({ title: `Delete the auto-reply for “${keywordList(rule.keyword).join(', ')}”?`, message: 'Customers who send this keyword will no longer get the automatic answer.', confirmLabel: 'Delete auto-reply', danger: true });
    if (!ok) return;
    try {
      await api(`/auto-replies/${rule.id}`, { method: 'DELETE' });
      toast.success('Auto-reply deleted');
      reload({ quiet: true });
    } catch (err) {
      toast.error(err);
    }
  }

  const add = isManager ? (
    <Button icon={LuPlus} onClick={() => setDialog({ rule: null })}>
      New auto-reply
    </Button>
  ) : null;

  const columns = [
    {
      key: 'keyword',
      header: 'When a message…',
      render: (r) => (
        <div className="flex max-w-xs flex-wrap items-center gap-1">
          <span className="mr-0.5 whitespace-nowrap text-mist-600">{MATCH_LABELS[r.matchType].replace('Message ', '')}</span>
          {keywordList(r.keyword).map((word, i) => (
            <span key={`${word}-${i}`} className="rounded bg-mist-100 px-1.5 py-0.5 font-medium text-mist-900">
              {word}
            </span>
          ))}
        </div>
      ),
    },
    { key: 'reply', header: 'Reply', render: (r) => <p className="line-clamp-2 max-w-xl whitespace-pre-wrap text-mist-700">{r.replyText}</p> },
    {
      key: 'active',
      header: 'On',
      render: (r) => <Toggle checked={r.isActive} onChange={(v) => toggle(r, v)} label={`Auto-reply for ${r.keyword}`} disabled={!isManager} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (r) =>
        isManager ? (
          <div className="flex justify-end">
            <IconButton label="Edit" icon={LuPencil} onClick={() => setDialog({ rule: r })} />
            <IconButton label="Delete" icon={LuTrash2} onClick={() => remove(r)} />
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="Auto-replies" description="Answer common questions the moment they arrive." actions={add} />
      <PageBody>
        <AwayPanel canEdit={isManager} />
        <h2 className="mb-2 font-display text-lg font-semibold text-mist-900">Keyword replies</h2>
        <Notice tone="blue" className="mb-4">
          If a message matches several rules, “is exactly” wins over “starts with”, which wins over “contains”. The same rule won’t fire twice within 10
          seconds in one chat.
        </Notice>
        <Panel>
          {loading && !data ? (
            <LoadingBlock />
          ) : error && !data ? (
            <ErrorBlock error={error} onRetry={reload} />
          ) : (
            <Table
              columns={columns}
              rows={data.items}
              empty={
                <EmptyState icon={LuZap} title="No auto-replies yet" action={add}>
                  For example: when someone sends “hi, hello or hey”, reply with a welcome message.
                </EmptyState>
              }
            />
          )}
        </Panel>
      </PageBody>
      <RuleDialog open={Boolean(dialog)} rule={dialog?.rule ?? null} onClose={() => setDialog(null)} onSaved={() => reload({ quiet: true })} />
    </>
  );
}
