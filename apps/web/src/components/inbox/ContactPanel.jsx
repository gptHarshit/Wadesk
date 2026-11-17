'use client';

import { useEffect, useState } from 'react';
import { LuMail, LuPhone, LuX } from 'react-icons/lu';
import { api } from '@/lib/api';
import { contactLabel, formatDate, formatPhone } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { Avatar, Button, ErrorBlock, IconButton, Input, LoadingBlock, TagPill, Textarea, Toggle, useFeedback } from '../ui';

/** Right-hand panel in the inbox: who you're talking to, with quick edits. */
export function ContactPanel({ conversation, team, onClose, onContactChanged, onPatchConversation }) {
  const { toast } = useFeedback();
  const contactId = conversation.contact.id;
  const { data: contact, error, loading, reload, setData } = useApi(`/contacts/${contactId}`);
  const { data: tagData } = useApi('/tags');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (contact) {
      setName(contact.name ?? '');
      setEmail(contact.email ?? '');
      setNotes(contact.notes ?? '');
    }
  }, [contact]);

  async function save(changes, message) {
    setSaving(true);
    try {
      const updated = await api(`/contacts/${contactId}`, { method: 'PATCH', body: changes });
      setData((current) => ({ ...current, ...updated }));
      onContactChanged(updated);
      if (message) toast.success(message);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  const dirty = contact && (name !== (contact.name ?? '') || email !== (contact.email ?? '') || notes !== (contact.notes ?? ''));
  const tagIds = contact?.tags.map((t) => t.id) ?? [];
  const availableTags = (tagData?.items ?? []).filter((t) => !tagIds.includes(t.id));

  return (
    <aside className="flex h-full w-full flex-col border-l border-mist-200 bg-white" aria-label="Contact details">
      <div className="flex items-center justify-between border-b border-mist-200 px-4 py-2.5">
        <h2 className="font-semibold text-mist-900">Contact</h2>
        <IconButton label="Close contact details" icon={LuX} onClick={onClose} />
      </div>

      {loading && !contact ? (
        <LoadingBlock />
      ) : error && !contact ? (
        <ErrorBlock error={error} onRetry={reload} />
      ) : (
        <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div className="flex flex-col items-center text-center">
            <Avatar label={contactLabel(contact)} seed={contact.id} size="lg" />
            <p className="mt-2 font-semibold text-mist-900">{contactLabel(contact)}</p>
            <p className="flex items-center gap-1.5 text-sm text-mist-600">
              <LuPhone className="h-3.5 w-3.5" aria-hidden />
              {formatPhone(contact.phone) || 'Number hidden'}
            </p>
            {contact.waUsername ? <p className="text-sm text-mist-500">{contact.waUsername}</p> : null}
            {contact.email ? (
              <p className="flex items-center gap-1.5 text-sm text-mist-600">
                <LuMail className="h-3.5 w-3.5" aria-hidden />
                {contact.email}
              </p>
            ) : null}
          </div>

          <label className="block text-sm sm:hidden">
            <span className="mb-1 block font-medium text-mist-800">Assigned to</span>
            <select
              value={conversation.assignedTo ?? ''}
              onChange={(e) => onPatchConversation({ assignedTo: e.target.value || null })}
              className="h-10 w-full rounded-md border border-mist-300 bg-white px-2"
            >
              <option value="">Unassigned</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="mb-1.5 text-sm font-medium text-mist-800">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map((tag) => (
                <TagPill key={tag.id} tag={tag} onRemove={() => save({ tagIds: tagIds.filter((id) => id !== tag.id) })} />
              ))}
              {!contact.tags.length ? <span className="text-sm text-mist-500">No tags</span> : null}
            </div>
            {availableTags.length ? (
              <select
                value=""
                onChange={(e) => e.target.value && save({ tagIds: [...tagIds, e.target.value] })}
                aria-label="Add a tag"
                className="mt-2 h-9 w-full rounded-md border border-mist-300 bg-white px-2 text-sm text-mist-700"
              >
                <option value="">Add a tag…</option>
                {availableTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save({ name, email, notes }, 'Contact saved');
            }}
          >
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Textarea label="Notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the team should know" />
            {dirty ? (
              <Button type="submit" size="sm" loading={saving}>
                Save changes
              </Button>
            ) : null}
          </form>

          <div className="flex items-start justify-between gap-3 border-t border-mist-200 pt-4">
            <div>
              <p className="text-sm font-medium text-mist-800">Opted out of campaigns</p>
              <p className="text-sm text-mist-500">Turns on by itself when they send STOP.</p>
            </div>
            <Toggle checked={contact.optedOut} onChange={(optedOut) => save({ optedOut })} label="Opted out of campaigns" disabled={saving} />
          </div>

          <p className="text-xs text-mist-500">Added {formatDate(contact.createdAt)}</p>
        </div>
      )}
    </aside>
  );
}
