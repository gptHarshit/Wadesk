'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LuArrowLeft, LuBan, LuClock, LuDownload, LuSend, LuTrash2 } from 'react-icons/lu';
import { CampaignProgress, CampaignStatus, isRunning } from '@/components/campaigns';
import { TemplatePreview } from '@/components/templates';
import { Badge, Button, EmptyState, ErrorBlock, Input, LoadingBlock, Modal, Notice, PageBody, PageHeader, Pagination, Panel, Table, Tabs, useFeedback } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatPhone, percent, plural } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';

const LIMIT = 25;
const RECIPIENT_TONES = { pending: 'neutral', sent: 'blue', delivered: 'green', read: 'green', failed: 'red', skipped: 'neutral' };

function Stat({ label, value, share }) {
  return (
    <div className="rounded-lg border border-mist-200 bg-surface px-4 py-3">
      <p className="text-sm text-mist-600">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-semibold tabular-nums tracking-tight text-mist-900">{Number(value).toLocaleString()}</p>
      {share !== undefined ? <p className="text-sm tabular-nums text-mist-500">{share}%</p> : null}
    </div>
  );
}

const pad = (n) => String(n).padStart(2, '0');
/** A Date as the value a datetime-local input expects, in this computer's time. */
const localInputValue = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Pick when a campaign should go out. */
function ScheduleDialog({ open, campaign, onClose, onScheduled }) {
  const { toast } = useFeedback();
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const start = campaign.scheduledAt ? new Date(campaign.scheduledAt) : new Date(Date.now() + 60 * 60 * 1000);
    if (!campaign.scheduledAt) start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    setValue(localInputValue(start));
  }, [open, campaign.scheduledAt]);

  async function submit(event) {
    event.preventDefault();
    const when = new Date(value);
    if (!value || Number.isNaN(when.getTime())) {
      setError('Pick a date and time.');
      return;
    }
    if (when.getTime() < Date.now() + 2 * 60 * 1000) {
      setError('Pick a time at least 2 minutes from now, or use Send now.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/campaigns/${campaign.id}/schedule`, { method: 'POST', body: { sendAt: when.toISOString() } });
      toast.success(`Scheduled for ${formatDateTime(when)}`);
      onScheduled();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={campaign.scheduledAt ? 'Change the send time' : 'Schedule this campaign'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-form" icon={LuClock} loading={busy}>
            Schedule
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} className="space-y-3" noValidate>
        {error ? <Notice tone="red">{error}</Notice> : null}
        <Input
          label="Send on"
          type="datetime-local"
          value={value}
          min={localInputValue(new Date(Date.now() + 5 * 60 * 1000))}
          onChange={(e) => setValue(e.target.value)}
          hint="In your computer’s time. You can change or cancel it until it starts sending."
        />
        <p className="text-sm text-mist-600">
          It goes to everyone in the audience at that moment, so contacts you add before then are included.
        </p>
      </form>
    </Modal>
  );
}

function Recipients({ campaignId, campaignName, refreshKey }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { toast } = useFeedback();
  const [downloading, setDownloading] = useState(false);
  const { data, error, loading, reload } = useApi(`/campaigns/${campaignId}/recipients`, { status, page, limit: LIMIT });
  useEffect(() => setPage(1), [status]);

  async function download() {
    setDownloading(true);
    try {
      const blob = await api(`/campaigns/${campaignId}/report.csv`, { blob: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${campaignName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign'}-report.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err);
    } finally {
      setDownloading(false);
    }
  }
  useEffect(() => {
    if (refreshKey) reload({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const columns = [
    {
      key: 'contact',
      header: 'Contact',
      render: (r) => (
        <div>
          <p className="font-medium text-mist-900">{r.contactName || formatPhone(r.contactPhone) || 'Unknown'}</p>
          {r.contactName ? <p className="text-sm tabular-nums text-mist-500">{formatPhone(r.contactPhone)}</p> : null}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={RECIPIENT_TONES[r.status]}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</Badge> },
    {
      key: 'detail',
      header: 'Detail',
      render: (r) => (
        <span className="text-sm text-mist-600">
          {r.errorMessage || '—'}
          {r.errorCode ? ` (code ${r.errorCode})` : ''}
        </span>
      ),
    },
    { key: 'updated', header: 'Updated', render: (r) => <span className="whitespace-nowrap text-sm text-mist-600">{formatDateTime(r.updatedAt)}</span> },
  ];

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg font-semibold text-mist-900">Recipients</h2>
          <Button variant="secondary" size="sm" icon={LuDownload} onClick={download} loading={downloading}>
            Download report (CSV)
          </Button>
        </div>
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: '', label: 'All' },
            { value: 'delivered', label: 'Delivered' },
            { value: 'read', label: 'Read' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
      </div>
      {loading && !data ? (
        <LoadingBlock />
      ) : error && !data ? (
        <ErrorBlock error={error} onRetry={reload} />
      ) : (
        <>
          <Table columns={columns} rows={data.items} empty={<EmptyState title="Nobody here">No recipients with this status.</EmptyState>} />
          <Pagination page={page} limit={LIMIT} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

export default function CampaignPage() {
  const { id } = useParams();
  const router = useRouter();
  const { isManager } = useAuth();
  const { toast, confirm } = useFeedback();
  const { data: campaign, error, loading, reload } = useApi(`/campaigns/${id}`);
  const { data: templateData } = useApi('/templates');
  const { data: tagData } = useApi('/tags');
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const running = campaign ? isRunning(campaign.status) : false;

  const refresh = () => {
    reload({ quiet: true });
    setRefreshKey((k) => k + 1);
  };
  useSocketEvent('campaign:updated', (event) => event.id === id && refresh());
  // Delivery and read receipts keep arriving, so keep the numbers fresh while it sends.
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  async function act(path, method, success, after) {
    setBusy(true);
    try {
      await api(path, { method });
      toast.success(success);
      if (after) after();
      else refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    const ok = await confirm({
      title: `Send to ${plural(campaign.audienceSize ?? 0, 'contact')}?`,
      message: 'Messages start going out straight away, and Meta bills template messages at your WhatsApp rates. You can stop the unsent part while it runs.',
      confirmLabel: 'Send now',
    });
    if (ok) act(`/campaigns/${id}/launch`, 'POST', 'Campaign started');
  }
  async function unschedule() {
    const ok = await confirm({
      title: 'Cancel the schedule?',
      message: 'The campaign goes back to a draft and nothing is sent. You can send or schedule it again later.',
      confirmLabel: 'Cancel schedule',
    });
    if (ok) act(`/campaigns/${id}/unschedule`, 'POST', 'Schedule cancelled');
  }
  async function cancel() {
    const ok = await confirm({ title: 'Stop this campaign?', message: 'Messages already sent stay sent. The rest will be skipped.', confirmLabel: 'Stop sending', danger: true });
    if (ok) act(`/campaigns/${id}/cancel`, 'POST', 'Campaign stopped');
  }
  async function remove() {
    const ok = await confirm({ title: 'Delete this campaign?', message: 'Its report is deleted. Messages stay in the inbox.', confirmLabel: 'Delete campaign', danger: true });
    if (ok) act(`/campaigns/${id}`, 'DELETE', 'Campaign deleted', () => router.push('/campaigns'));
  }

  const back = (
    <Link href="/campaigns" className="inline-flex h-10 items-center gap-2 rounded-md border border-mist-300 bg-surface px-4 font-medium text-mist-800 hover:bg-mist-50">
      <LuArrowLeft className="h-4 w-4" aria-hidden />
      All campaigns
    </Link>
  );

  if (loading && !campaign) {
    return (
      <>
        <PageHeader title="Campaign" actions={back} />
        <LoadingBlock />
      </>
    );
  }
  if (error && !campaign) {
    return (
      <>
        <PageHeader title="Campaign" actions={back} />
        <ErrorBlock error={error} onRetry={reload} />
      </>
    );
  }

  const stats = campaign.stats;
  const template = templateData?.items.find((t) => t.id === campaign.templateId) ?? null;
  const tagNames = campaign.audience.type === 'tags' ? (tagData?.items ?? []).filter((t) => campaign.audience.tagIds.includes(t.id)).map((t) => t.name) : [];
  const audienceText = campaign.audience.type === 'all' ? 'All contacts' : `Contacts tagged ${tagNames.length ? tagNames.join(', ') : '(deleted tags)'}`;
  const scheduled = campaign.status === 'scheduled';
  const draft = campaign.status === 'draft' || scheduled;

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`Template “${campaign.templateName}” to ${audienceText.charAt(0).toLowerCase() + audienceText.slice(1)}`}
        actions={
          <>
            {back}
            {isManager && running ? (
              <Button variant="danger" icon={LuBan} onClick={cancel} loading={busy}>
                Stop sending
              </Button>
            ) : null}
            {isManager && !running ? (
              <Button variant="secondary" icon={LuTrash2} onClick={remove} disabled={busy}>
                Delete
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-mist-600">
          <CampaignStatus status={campaign.status} />
          <span>Created by {campaign.createdByName || 'a removed member'} on {formatDateTime(campaign.createdAt)}</span>
          {campaign.startedAt ? <span>Started {formatDateTime(campaign.startedAt)}</span> : null}
          {campaign.completedAt ? <span>Finished {formatDateTime(campaign.completedAt)}</span> : null}
        </div>

        {campaign.errorMessage ? <Notice tone="red" title="This campaign could not start">{campaign.errorMessage}</Notice> : null}

        {draft ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Panel className="p-5">
              <h2 className="font-display text-lg font-semibold text-mist-900">{scheduled ? 'Scheduled' : 'Ready to send'}</h2>
              {scheduled ? (
                <Notice tone="blue" icon={LuClock} className="mt-3" title={`Goes out ${formatDateTime(campaign.scheduledAt)}`}>
                  WaDesk sends it automatically at that time. You can change the time or cancel it until then.
                </Notice>
              ) : null}
              <dl className="mt-3 space-y-2 text-mist-700">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-mist-500">Audience</dt>
                  <dd>{audienceText}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-mist-500">Recipients</dt>
                  <dd>
                    <strong className="text-mist-900">{plural(campaign.audienceSize ?? 0, 'contact')}</strong> right now (opted-out contacts are left out)
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-mist-500">Template</dt>
                  <dd>{campaign.templateName} ({campaign.templateLanguage})</dd>
                </div>
              </dl>
              {!campaign.templateId ? (
                <Notice tone="red" className="mt-4" title="The template was deleted in WhatsApp Manager">
                  Delete this campaign and create a new one with a current template.
                </Notice>
              ) : isManager && scheduled ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button icon={LuClock} onClick={() => setScheduleOpen(true)} disabled={busy}>
                    Change time
                  </Button>
                  <Button variant="secondary" onClick={unschedule} loading={busy}>
                    Cancel schedule
                  </Button>
                </div>
              ) : isManager ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button icon={LuSend} onClick={launch} loading={busy} disabled={!campaign.audienceSize}>
                    Send to {plural(campaign.audienceSize ?? 0, 'contact')}
                  </Button>
                  <Button variant="secondary" icon={LuClock} onClick={() => setScheduleOpen(true)} disabled={busy || !campaign.audienceSize}>
                    Schedule for later
                  </Button>
                </div>
              ) : (
                <p className="mt-4 text-mist-600">An owner or admin can {scheduled ? 'change this schedule' : 'send this campaign'}.</p>
              )}
            </Panel>
            {template ? <TemplatePreview template={template} variables={campaign.variables} contact={{ name: 'Anil Kumar' }} /> : null}
          </div>
        ) : (
          <>
            <Panel className="p-5">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-mist-900">
                  {running ? 'Sending…' : 'Results'}
                </h2>
                <p className="text-sm tabular-nums text-mist-600">
                  {(stats.total - stats.pending).toLocaleString()} of {stats.total.toLocaleString()} processed
                </p>
              </div>
              <CampaignProgress stats={stats} />
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mist-600">
                {[
                  ['bg-leaf-700', 'Read'],
                  ['bg-leaf-500', 'Delivered'],
                  ['bg-leaf-200', 'Sent'],
                  ['bg-brick-600', 'Failed'],
                ].map(([tone, label]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-sm ${tone}`} aria-hidden />
                    {label}
                  </span>
                ))}
              </div>
            </Panel>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <Stat label="Recipients" value={stats.total} />
              <Stat label="Sent" value={stats.sent} share={percent(stats.sent, stats.total)} />
              <Stat label="Delivered" value={stats.delivered} share={percent(stats.delivered, stats.sent)} />
              <Stat label="Read" value={stats.read} share={percent(stats.read, stats.sent)} />
              <Stat label="Failed" value={stats.failed} share={percent(stats.failed, stats.total)} />
            </div>
            {stats.skipped ? <p className="text-sm text-mist-600">{plural(stats.skipped, 'recipient')} skipped (campaign stopped or contact opted out).</p> : null}

            <Recipients campaignId={id} campaignName={campaign.name} refreshKey={refreshKey} />
          </>
        )}
      </PageBody>
      {isManager ? <ScheduleDialog open={scheduleOpen} campaign={campaign} onClose={() => setScheduleOpen(false)} onScheduled={refresh} /> : null}
    </>
  );
}
