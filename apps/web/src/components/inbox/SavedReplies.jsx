'use client';

import { useEffect, useMemo, useState } from 'react';
import { LuMessageSquare, LuPencil, LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Button, EmptyState, ErrorBlock, IconButton, Input, LoadingBlock, Modal, Notice, Textarea, useFeedback } from '../ui';

const NAME_FIELD = /\{\{\s*name\s*\}\}/gi;

/** Put the customer's first name where a saved reply says {{name}}. */
export function fillSavedReply(body, contact) {
  const first = String(contact?.name ?? '').trim().split(/\s+/)[0];
  return body.replace(NAME_FIELD, first || 'there');
}

function ReplyForm({ reply, onCancel, onSaved }) {
  const [title, setTitle] = useState(reply?.title ?? '');
  const [body, setBody] = useState(reply?.body ?? '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = reply
        ? await api(`/saved-replies/${reply.id}`, { method: 'PATCH', body: { title, body } })
        : await api('/saved-replies', { method: 'POST', body: { title, body } });
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-mist-200 bg-mist-50 p-3" noValidate>
      {error ? <Notice tone="red">{error.message}</Notice> : null}
      <Input label="Name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fees" maxLength={80} />
      <Textarea
        label="Reply"
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4096}
        placeholder="Hi {{name}}, the course fee is ₹4,999. You can pay online or at the office."
        hint="{{name}} becomes the customer’s first name when you insert it."
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {reply ? 'Save changes' : 'Save reply'}
        </Button>
      </div>
    </form>
  );
}

/** Pick a saved reply to drop into the message box, and manage the shared list. */
export function SavedRepliesDialog({ open, onClose, onInsert }) {
  const { toast, confirm } = useFeedback();
  const { data, error, loading, reload, setData } = useApi(open ? '/saved-replies' : null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null, 'new', or a reply

  useEffect(() => {
    if (!open) {
      setSearch('');
      setEditing(null);
    }
  }, [open]);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)) : all;
  }, [data, search]);

  async function remove(reply) {
    const ok = await confirm({ title: `Delete “${reply.title}”?`, message: 'It is removed for everyone on the team.', confirmLabel: 'Delete reply', danger: true });
    if (!ok) return;
    try {
      await api(`/saved-replies/${reply.id}`, { method: 'DELETE' });
      setData((d) => ({ items: d.items.filter((r) => r.id !== reply.id) }));
      toast.success('Saved reply deleted');
    } catch (err) {
      toast.error(err);
    }
  }

  function saved(reply) {
    toast.success(editing === 'new' ? 'Reply saved' : 'Changes saved');
    setEditing(null);
    reload({ quiet: true });
    if (reply && editing === 'new') setSearch('');
  }

  const total = data?.items.length ?? 0;
  return (
    <Modal open={open} onClose={onClose} title="Saved replies" description="Answers your team sends often. Pick one to put it in the message box." size="lg">
      {loading && !data ? (
        <LoadingBlock />
      ) : error && !data ? (
        <ErrorBlock error={error} onRetry={reload} />
      ) : (
        <div className="space-y-3">
          {editing === 'new' ? (
            <ReplyForm onCancel={() => setEditing(null)} onSaved={saved} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {total > 4 ? (
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Search saved replies</span>
                  <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" aria-hidden />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    className="h-10 w-full rounded-md border border-mist-300 bg-surface pl-9 pr-3 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </label>
              ) : (
                <span className="flex-1" />
              )}
              <Button variant="secondary" icon={LuPlus} onClick={() => setEditing('new')}>
                New saved reply
              </Button>
            </div>
          )}

          {total === 0 && editing !== 'new' ? (
            <EmptyState icon={LuMessageSquare} title="No saved replies yet">
              Save answers you type again and again, like fees, address or timings. Everyone on the team can use them.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-mist-100 rounded-lg border border-mist-200">
              {items.map((reply) =>
                editing && editing !== 'new' && editing.id === reply.id ? (
                  <li key={reply.id} className="p-2">
                    <ReplyForm reply={reply} onCancel={() => setEditing(null)} onSaved={saved} />
                  </li>
                ) : (
                  <li key={reply.id} className="flex items-start gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => onInsert(reply)}
                      className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-mist-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    >
                      <span className="block font-medium text-mist-900">{reply.title}</span>
                      <span className="line-clamp-2 whitespace-pre-wrap text-sm text-mist-600">{reply.body}</span>
                    </button>
                    <IconButton label={`Edit ${reply.title}`} icon={LuPencil} onClick={() => setEditing(reply)} />
                    <IconButton label={`Delete ${reply.title}`} icon={LuTrash2} onClick={() => remove(reply)} />
                  </li>
                ),
              )}
              {items.length === 0 ? <li className="px-3 py-6 text-center text-mist-600">No saved reply matches “{search}”.</li> : null}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
