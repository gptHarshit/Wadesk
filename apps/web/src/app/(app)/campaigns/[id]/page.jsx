'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LuArrowLeft, LuBan, LuSend, LuTrash2 } from 'react-icons/lu';
import { CampaignProgress, CampaignStatus, isRunning } from '@/components/campaigns';
import { TemplatePreview } from '@/components/templates';
import { Badge, Button, EmptyState, ErrorBlock, LoadingBlock, Notice, PageBody, PageHeader, Pagination, Panel, Table, Tabs, useFeedback } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatPhone, percent, plural } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';

const LIMIT = 25;
const RECIPIENT_TONES = { pending: 'neutral', sent: 'blue', delivered: 'green', read: 'green', failed: 'red', skipped: 'neutral' };

function Stat({ label, value, share }) {
  return (
    <div className="rounded-lg border border-mist-200 bg-white px-4 py-3">
      <p className="text-sm text-mist-600">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-semibold tabular-nums tracking-tight text-mist-900">{Number(value).toLocaleString()}</p>
      {share !== undefined ? <p className="text-sm tabular-nums text-mist-500">{share}%</p> : null}
    </div>
  );
}

function Recipients({ campaignId, refreshKey }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi(`/campaigns/${campaignId}/recipients`, { status, page, limit: LIMIT });
  useEffect(() => setPage(1), [status]);
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
        <h2 className="font-display text-lg font-semibold text-mist-900">Recipients</h2>
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
  async function cancel() {
    const ok = await confirm({ title: 'Stop this campaign?', message: 'Messages already sent stay sent. The rest will be skipped.', confirmLabel: 'Stop sending', danger: true });
    if (ok) act(`/campaigns/${id}/cancel`, 'POST', 'Campaign stopped');
  }
  async function remove() {
    const ok = await confirm({ title: 'Delete this campaign?', message: 'Its report is deleted. Messages stay in the inbox.', confirmLabel: 'Delete campaign', danger: true });
    if (ok) act(`/campaigns/${id}`, 'DELETE', 'Campaign deleted', () => router.push('/campaigns'));
  }

  const back = (
    <Link href="/campaigns" className="inline-flex h-10 items-center gap-2 rounded-md border border-mist-300 bg-white px-4 font-medium text-mist-800 hover:bg-mist-50">
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
  const draft = campaign.status === 'draft';

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
              <h2 className="font-display text-lg font-semibold text-mist-900">Ready to send</h2>
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
              ) : isManager ? (
                <Button className="mt-5" icon={LuSend} onClick={launch} loading={busy} disabled={!campaign.audienceSize}>
                  Send to {plural(campaign.audienceSize ?? 0, 'contact')}
                </Button>
              ) : (
                <p className="mt-4 text-mist-600">An owner or admin can send this campaign.</p>
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

            <Recipients campaignId={id} refreshKey={refreshKey} />
          </>
        )}
      </PageBody>
    </>
  );
}
