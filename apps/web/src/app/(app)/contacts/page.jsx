'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LuMessageSquare, LuPencil, LuPlus, LuSearch, LuTag, LuTrash2, LuUpload, LuUsers } from 'react-icons/lu';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  Notice,
  PageBody,
  PageHeader,
  Pagination,
  Panel,
  TAG_COLOR_NAMES,
  Table,
  TagPill,
  Textarea,
  Toggle,
  cx,
  useFeedback,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatPhone, plural } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';

const LIMIT = 25;

/** Checkbox list of tags, shared by the contact form and the import dialog. */
function TagPicker({ tags, value, onChange }) {
  if (!tags.length) return <p className="text-sm text-mist-500">No tags yet. Create some with “Manage tags”.</p>;
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const on = value.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(tag.id)}
            className={cx(
              'rounded-full border px-2.5 py-1 text-sm font-medium transition-colors',
              on ? 'border-leaf-600 bg-leaf-600 text-white' : 'border-mist-300 bg-white text-mist-700 hover:bg-mist-50',
            )}
          >
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}

function ContactDialog({ open, contact, tags, onClose, onSaved }) {
  const { toast } = useFeedback();
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '', optedOut: false, tagIds: [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      contact
        ? {
            name: contact.name ?? '',
            phone: formatPhone(contact.phone),
            email: contact.email ?? '',
            notes: contact.notes ?? '',
            optedOut: contact.optedOut,
            tagIds: contact.tags.map((t) => t.id),
          }
        : { name: '', phone: '', email: '', notes: '', optedOut: false, tagIds: [] },
    );
  }, [open, contact]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name, email: form.email, notes: form.notes, tagIds: form.tagIds };
      // Contacts known only by WhatsApp username have no phone number to send.
      if (form.phone.trim()) body.phone = form.phone;
      if (contact) body.optedOut = form.optedOut;
      const saved = contact
        ? await api(`/contacts/${contact.id}`, { method: 'PATCH', body })
        : await api('/contacts', { method: 'POST', body });
      toast.success(contact ? 'Contact saved' : 'Contact added');
      onSaved(saved);
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
      title={contact ? 'Edit contact' : 'Add a contact'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="contact-form" loading={busy}>
            {contact ? 'Save contact' : 'Add contact'}
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} className="space-y-4" noValidate>
        {error ? <Notice tone="red">{error.message}</Notice> : null}
        <Input label="Name" value={form.name} onChange={set('name')} autoComplete="off" />
        <Input
          label="WhatsApp number"
          type="tel"
          value={form.phone}
          onChange={set('phone')}
          placeholder="+91 98765 43210"
          hint="Include the country code. Local 10-digit numbers get your workspace’s default code."
          required={!contact}
        />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} autoComplete="off" />
        <div>
          <p className="mb-1.5 text-sm font-medium text-mist-800">Tags</p>
          <TagPicker tags={tags} value={form.tagIds} onChange={(tagIds) => setForm((f) => ({ ...f, tagIds }))} />
        </div>
        <Textarea label="Notes" value={form.notes} onChange={set('notes')} />
        {contact ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-mist-50 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-mist-800">Opted out of campaigns</p>
              <p className="text-sm text-mist-500">They still get replies in the inbox.</p>
            </div>
            <Toggle checked={form.optedOut} onChange={(optedOut) => setForm((f) => ({ ...f, optedOut }))} label="Opted out of campaigns" />
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function ImportDialog({ open, tags, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [tagIds, setTagIds] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setTagIds([]);
      setResult(null);
      setError(null);
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      if (tagIds.length) form.set('tagIds', tagIds.join(','));
      setResult(await api('/contacts/import', { method: 'POST', form }));
      onImported();
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
      title="Import contacts from a CSV"
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={!file} icon={LuUpload}>
              Import contacts
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone="green" title={`${plural(result.created, 'contact')} added, ${result.updated.toLocaleString()} updated`}>
            {result.totalRows.toLocaleString()} rows read.
            {result.duplicatesInFile ? ` ${plural(result.duplicatesInFile, 'repeated number')} in the file skipped.` : ''}
          </Notice>
          {result.invalid ? (
            <Notice tone="amber" title={`${plural(result.invalid, 'row')} skipped`}>
              <ul className="mt-1 list-disc pl-4">
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
              {result.invalid > result.errors.length ? <p className="mt-1">…and {result.invalid - result.errors.length} more.</p> : null}
            </Notice>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {error ? <Notice tone="red">{error.message}</Notice> : null}
          <p className="text-mist-700">
            The first row must be headings. A <strong>phone</strong> column is required; <strong>name</strong>, <strong>email</strong> and{' '}
            <strong>tags</strong> are optional. Separate several tags with a semicolon. Numbers already in your contacts are updated, not
            duplicated.
          </p>
          <pre className="overflow-x-auto rounded-md bg-mist-100 px-3 py-2 text-sm text-mist-700">
            {'name,phone,email,tags\nAnil Kumar,+91 98765 43210,anil@example.com,VIP;Wholesale'}
          </pre>
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed border-mist-300 px-4 py-6 text-mist-600 transition-colors hover:border-leaf-600 hover:bg-leaf-50"
          >
            <LuUpload className="h-6 w-6" aria-hidden />
            <span className="font-medium text-mist-900">{file ? file.name : 'Choose a CSV file'}</span>
            <span className="text-sm">{file ? 'Click to choose a different file' : 'Up to 50,000 rows'}</span>
          </button>
          <div>
            <p className="mb-1.5 text-sm font-medium text-mist-800">Tag every imported contact with</p>
            <TagPicker tags={tags} value={tagIds} onChange={setTagIds} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function TagsDialog({ open, tags, isManager, onClose, onChanged }) {
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState('');
  const [color, setColor] = useState('slate');
  const [busy, setBusy] = useState(false);

  async function add(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api('/tags', { method: 'POST', body: { name, color } });
      setName('');
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(tag) {
    const ok = await confirm({
      title: `Delete the tag “${tag.name}”?`,
      message: `It will be removed from ${plural(tag.contactCount, 'contact')}. The contacts themselves stay.`,
      confirmLabel: 'Delete tag',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/tags/${tag.id}`, { method: 'DELETE' });
      toast.success('Tag deleted');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Tags" description="Tags group contacts so you can target them in campaigns.">
      <form onSubmit={add} className="flex items-end gap-2">
        <Input label="New tag" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1" maxLength={40} />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-mist-800">Colour</span>
          <select value={color} onChange={(e) => setColor(e.target.value)} className="h-10 rounded-md border border-mist-300 bg-white px-2 capitalize">
            {TAG_COLOR_NAMES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          Add tag
        </Button>
      </form>
      <ul className="mt-4 divide-y divide-mist-100">
        {tags.map((tag) => (
          <li key={tag.id} className="flex items-center gap-3 py-2">
            <TagPill tag={tag} />
            <span className="flex-1 text-sm text-mist-500">{plural(tag.contactCount, 'contact')}</span>
            {isManager ? <IconButton label={`Delete tag ${tag.name}`} icon={LuTrash2} onClick={() => remove(tag)} /> : null}
          </li>
        ))}
        {!tags.length ? <li className="py-6 text-center text-mist-500">No tags yet.</li> : null}
      </ul>
    </Modal>
  );
}

export default function ContactsPage() {
  const router = useRouter();
  const { isManager } = useAuth();
  const { toast, confirm } = useFeedback();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput.trim());
  const [tagId, setTagId] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // { type: 'contact' | 'import' | 'tags', contact? }
  const { data, error, loading, reload } = useApi('/contacts', { search, tagId, page, limit: LIMIT });
  const { data: tagData, reload: reloadTags } = useApi('/tags');
  const tags = tagData?.items ?? [];

  useEffect(() => setPage(1), [search, tagId]);
  const refresh = () => {
    reload({ quiet: true });
    reloadTags({ quiet: true });
  };

  async function message(contact) {
    try {
      const conversation = await api('/conversations', { method: 'POST', body: { contactId: contact.id } });
      router.push(`/inbox?c=${conversation.id}`);
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove(contact) {
    const ok = await confirm({
      title: `Delete ${contact.name || formatPhone(contact.phone) || 'this contact'}?`,
      message: 'Their conversation and message history will be deleted too. This can’t be undone.',
      confirmLabel: 'Delete contact',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/contacts/${contact.id}`, { method: 'DELETE' });
      toast.success('Contact deleted');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-mist-900">{c.name || <span className="font-normal text-mist-500">No name</span>}</p>
          {c.email ? <p className="truncate text-sm text-mist-500">{c.email}</p> : null}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'WhatsApp number',
      render: (c) => <span className="whitespace-nowrap tabular-nums text-mist-700">{formatPhone(c.phone) || c.waUsername || 'Hidden'}</span>,
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.tags.map((tag) => (
            <TagPill key={tag.id} tag={tag} />
          ))}
          {c.optedOut ? <Badge tone="red">Opted out</Badge> : null}
        </div>
      ),
    },
    { key: 'created', header: 'Added', render: (c) => <span className="whitespace-nowrap text-sm text-mist-600">{formatDate(c.createdAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (c) => (
        <div className="flex justify-end">
          <IconButton label="Message" icon={LuMessageSquare} onClick={() => message(c)} />
          <IconButton label="Edit" icon={LuPencil} onClick={() => setDialog({ type: 'contact', contact: c })} />
          {isManager ? <IconButton label="Delete" icon={LuTrash2} onClick={() => remove(c)} /> : null}
        </div>
      ),
    },
  ];

  const filtered = Boolean(search || tagId);
  return (
    <>
      <PageHeader
        title="Contacts"
        description={data ? `${plural(data.total, 'contact')}${filtered ? ' match your filter' : ''}` : undefined}
        actions={
          <>
            <Button variant="secondary" icon={LuTag} onClick={() => setDialog({ type: 'tags' })}>
              Manage tags
            </Button>
            {isManager ? (
              <Button variant="secondary" icon={LuUpload} onClick={() => setDialog({ type: 'import' })}>
                Import CSV
              </Button>
            ) : null}
            <Button icon={LuPlus} onClick={() => setDialog({ type: 'contact', contact: null })}>
              Add contact
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap gap-2">
          <div className="relative min-w-52 flex-1 sm:max-w-sm">
            <LuSearch className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-mist-400" aria-hidden />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, number or email"
              aria-label="Search contacts"
              className="h-10 w-full rounded-md border border-mist-300 bg-white pl-9 pr-3 placeholder:text-mist-400 focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/20"
            />
          </div>
          <select
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            aria-label="Filter by tag"
            className="h-10 rounded-md border border-mist-300 bg-white px-3 text-mist-800"
          >
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name} ({tag.contactCount})
              </option>
            ))}
          </select>
        </div>

        <Panel>
          {loading && !data ? (
            <LoadingBlock label="Loading contacts" />
          ) : error && !data ? (
            <ErrorBlock error={error} onRetry={reload} />
          ) : (
            <>
              <Table
                columns={columns}
                rows={data.items}
                empty={
                  filtered ? (
                    <EmptyState icon={LuSearch} title="No contacts match">
                      Try a different search or tag.
                    </EmptyState>
                  ) : (
                    <EmptyState
                      icon={LuUsers}
                      title="No contacts yet"
                      action={
                        <>
                          {isManager ? (
                            <Button variant="secondary" icon={LuUpload} onClick={() => setDialog({ type: 'import' })}>
                              Import CSV
                            </Button>
                          ) : null}
                          <Button icon={LuPlus} onClick={() => setDialog({ type: 'contact', contact: null })}>
                            Add contact
                          </Button>
                        </>
                      }
                    >
                      People who message your number are added automatically. You can also add or import them.
                    </EmptyState>
                  )
                }
              />
              <Pagination page={page} limit={LIMIT} total={data.total} onPage={setPage} />
            </>
          )}
        </Panel>
      </PageBody>

      <ContactDialog open={dialog?.type === 'contact'} contact={dialog?.contact ?? null} tags={tags} onClose={() => setDialog(null)} onSaved={refresh} />
      <ImportDialog open={dialog?.type === 'import'} tags={tags} onClose={() => setDialog(null)} onImported={refresh} />
      <TagsDialog open={dialog?.type === 'tags'} tags={tags} isManager={isManager} onClose={() => setDialog(null)} onChanged={refresh} />
    </>
  );
}
