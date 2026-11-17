'use client';

import { useEffect, useState } from 'react';
import { LuPencil, LuPlus, LuTrash2, LuZap } from 'react-icons/lu';
import { Button, EmptyState, ErrorBlock, IconButton, Input, LoadingBlock, Modal, Notice, PageBody, PageHeader, Panel, Select, Table, Textarea, Toggle, useFeedback } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';

const MATCH_LABELS = { contains: 'Message contains', exact: 'Message is exactly', starts_with: 'Message starts with' };

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
          <Input label="Keyword" value={form.keyword} onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))} placeholder="price" maxLength={100} hint="Capital letters don’t matter." />
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
    const ok = await confirm({ title: `Delete the auto-reply for “${rule.keyword}”?`, message: 'Customers who send this keyword will no longer get the automatic answer.', confirmLabel: 'Delete auto-reply', danger: true });
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
        <p className="whitespace-nowrap">
          <span className="text-mist-600">{MATCH_LABELS[r.matchType].replace('Message ', '')}</span>{' '}
          <span className="rounded bg-mist-100 px-1.5 py-0.5 font-medium text-mist-900">{r.keyword}</span>
        </p>
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
                  For example: when a message contains “price”, reply with your price list.
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
