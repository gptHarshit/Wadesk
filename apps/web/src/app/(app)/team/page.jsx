'use client';

import { useEffect, useState } from 'react';
import { LuCopy, LuLink, LuTrash2, LuUserPlus } from 'react-icons/lu';
import { Avatar, Badge, Button, ErrorBlock, IconButton, Input, LoadingBlock, Modal, Notice, PageBody, PageHeader, Panel, Select, Table, useCopy, useFeedback } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatListTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

const ROLE_HELP = {
  owner: 'Full access. There is one owner.',
  admin: 'Everything except managing the owner or other admins.',
  agent: 'Inbox and contacts. Can’t change settings, team or campaigns.',
};

function InviteLink({ invite }) {
  const copy = useCopy();
  return (
    <div className="space-y-3">
      <Notice tone="green" title={invite.emailed ? 'Invite emailed' : 'Invite created'}>
        {invite.emailed ? 'They can also use the link below.' : 'Email isn’t set up on this server, so send them this link yourself.'} It works for 7 days.
      </Notice>
      <div className="flex gap-2">
        <input readOnly value={invite.inviteUrl} aria-label="Invite link" onFocus={(e) => e.target.select()} className="h-10 min-w-0 flex-1 rounded-md border border-mist-300 bg-mist-50 px-3 text-sm text-mist-700" />
        <Button variant="secondary" icon={LuCopy} onClick={() => copy(invite.inviteUrl, 'Invite link copied')}>
          Copy
        </Button>
      </div>
    </div>
  );
}

function InviteDialog({ open, canAddAdmins, onClose, onInvited }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'agent' });
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', role: 'agent' });
      setInvite(null);
      setError(null);
    }
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setInvite(await api('/team/invite', { method: 'POST', body: form }));
      onInvited();
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
      title="Invite a team member"
      footer={
        invite ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" loading={busy}>
              Send invite
            </Button>
          </>
        )
      }
    >
      {invite ? (
        <InviteLink invite={invite} />
      ) : (
        <form id="invite-form" onSubmit={submit} className="space-y-4" noValidate>
          {error ? <Notice tone="red">{error.message}</Notice> : null}
          <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoComplete="off" />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} autoComplete="off" />
          <Select label="Role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} hint={ROLE_HELP[form.role]}>
            <option value="agent">Agent</option>
            {canAddAdmins ? <option value="admin">Admin</option> : null}
          </Select>
        </form>
      )}
    </Modal>
  );
}

export default function TeamPage() {
  const { user, isManager } = useAuth();
  const { toast, confirm } = useFeedback();
  const { data, error, loading, reload } = useApi('/team');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState(null);
  const isOwner = user.role === 'owner';

  /** Managers can change agents; only the owner can change admins. Nobody changes the owner or themselves. */
  const canManage = (member) => isManager && member.role !== 'owner' && member.id !== user.id && (isOwner || member.role !== 'admin');

  async function update(member, changes, message) {
    try {
      await api(`/team/${member.id}`, { method: 'PATCH', body: changes });
      toast.success(message);
      reload({ quiet: true });
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove(member) {
    const ok = await confirm({
      title: `Remove ${member.name}?`,
      message: 'They lose access immediately. Chats assigned to them become unassigned; messages they sent stay.',
      confirmLabel: 'Remove member',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/team/${member.id}`, { method: 'DELETE' });
      toast.success('Member removed');
      reload({ quiet: true });
    } catch (err) {
      toast.error(err);
    }
  }

  async function newLink(member) {
    try {
      setLink(await api(`/team/${member.id}/invite-link`, { method: 'POST' }));
    } catch (err) {
      toast.error(err);
    }
  }

  const columns = [
    {
      key: 'member',
      header: 'Member',
      render: (m) => (
        <div className="flex items-center gap-3">
          <Avatar label={m.name} seed={m.id} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-mist-900">
              {m.name}
              {m.id === user.id ? <span className="font-normal text-mist-500"> (you)</span> : null}
            </p>
            <p className="truncate text-sm text-mist-500">{m.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (m) =>
        canManage(m) && isOwner && m.status !== 'invited' ? (
          <select
            value={m.role}
            onChange={(e) => update(m, { role: e.target.value }, `${m.name} is now ${e.target.value === 'admin' ? 'an admin' : 'an agent'}`)}
            aria-label={`Role for ${m.name}`}
            className="h-9 rounded-md border border-mist-300 bg-surface px-2 text-sm capitalize"
          >
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </select>
        ) : (
          <span className="capitalize text-mist-700">{m.role}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (m) =>
        m.status === 'invited' ? <Badge tone="amber">Invite pending</Badge> : m.status === 'disabled' ? <Badge tone="red">Disabled</Badge> : <Badge tone="green">Active</Badge>,
    },
    {
      key: 'seen',
      header: 'Last sign-in',
      render: (m) => <span className="whitespace-nowrap text-sm text-mist-600">{m.lastLoginAt ? formatListTime(m.lastLoginAt) : `Added ${formatDate(m.createdAt)}`}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (m) =>
        canManage(m) ? (
          <div className="flex items-center justify-end gap-1">
            {m.status === 'invited' ? (
              <Button variant="ghost" size="sm" icon={LuLink} onClick={() => newLink(m)}>
                New invite link
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update(m, { status: m.status === 'disabled' ? 'active' : 'disabled' }, m.status === 'disabled' ? `${m.name} can sign in again` : `${m.name} is disabled`)}
              >
                {m.status === 'disabled' ? 'Enable' : 'Disable'}
              </Button>
            )}
            <IconButton label={`Remove ${m.name}`} icon={LuTrash2} onClick={() => remove(m)} />
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone here shares the same WhatsApp inbox."
        actions={
          isManager ? (
            <Button icon={LuUserPlus} onClick={() => setInviteOpen(true)}>
              Invite member
            </Button>
          ) : null
        }
      />
      <PageBody>
        <Panel>{loading && !data ? <LoadingBlock /> : error && !data ? <ErrorBlock error={error} onRetry={reload} /> : <Table columns={columns} rows={data.items} />}</Panel>
        <dl className="mt-6 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          {Object.entries(ROLE_HELP).map(([role, help]) => (
            <div key={role}>
              <dt className="font-semibold capitalize text-mist-900">{role}</dt>
              <dd className="text-mist-600">{help}</dd>
            </div>
          ))}
        </dl>
      </PageBody>

      <InviteDialog open={inviteOpen} canAddAdmins={isOwner} onClose={() => setInviteOpen(false)} onInvited={() => reload({ quiet: true })} />
      <Modal open={Boolean(link)} onClose={() => setLink(null)} title="New invite link" footer={<Button onClick={() => setLink(null)}>Done</Button>}>
        {link ? <InviteLink invite={link} /> : null}
      </Modal>
    </>
  );
}
