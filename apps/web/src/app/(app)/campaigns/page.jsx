'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LuMegaphone, LuPlus } from 'react-icons/lu';
import { CampaignProgress, CampaignStatus, isRunning } from '@/components/campaigns';
import { EmptyState, ErrorBlock, LoadingBlock, PageBody, PageHeader, Pagination, Panel, Table } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatDateTime, percent } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';

const LIMIT = 20;
const linkButton = 'inline-flex h-10 items-center gap-2 rounded-md bg-leaf-600 px-4 font-medium text-white transition-colors hover:bg-leaf-700';

export default function CampaignsPage() {
  const { isManager } = useAuth();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi('/campaigns', { page, limit: LIMIT });
  useSocketEvent('campaign:updated', () => reload({ quiet: true }));

  const newCampaign = isManager ? (
    <Link href="/campaigns/new" className={linkButton}>
      <LuPlus className="h-4 w-4" aria-hidden />
      New campaign
    </Link>
  ) : null;

  const columns = [
    {
      key: 'name',
      header: 'Campaign',
      render: (c) => (
        <Link href={`/campaigns/${c.id}`} className="block">
          <span className="font-medium text-mist-900 underline-offset-2 hover:underline">{c.name}</span>
          <span className="block text-sm text-mist-500">Template: {c.templateName}</span>
        </Link>
      ),
    },
    { key: 'status', header: 'Status', render: (c) => <CampaignStatus status={c.status} /> },
    {
      key: 'progress',
      header: 'Progress',
      className: 'w-56',
      render: (c) =>
        c.stats.total ? (
          <div>
            <CampaignProgress stats={c.stats} />
            <p className="mt-1 text-sm tabular-nums text-mist-600">
              {c.stats.sent.toLocaleString()} of {c.stats.total.toLocaleString()} sent{c.stats.failed ? `, ${c.stats.failed.toLocaleString()} failed` : ''}
            </p>
          </div>
        ) : (
          <span className="text-sm text-mist-500">{isRunning(c.status) ? 'Preparing…' : '—'}</span>
        ),
    },
    {
      key: 'read',
      header: 'Read',
      align: 'right',
      render: (c) => <span className="tabular-nums text-mist-700">{c.stats.sent ? `${percent(c.stats.read, c.stats.sent)}%` : '—'}</span>,
    },
    {
      key: 'date',
      header: 'Started',
      render: (c) => (
        <span className="whitespace-nowrap text-sm text-mist-600">
          {c.startedAt ? formatDateTime(c.startedAt) : c.status === 'scheduled' && c.scheduledAt ? `Goes out ${formatDateTime(c.scheduledAt)}` : 'Not yet'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Campaigns" description="Send one approved template to many contacts and track what happens." actions={newCampaign} />
      <PageBody>
        <Panel>
          {loading && !data ? (
            <LoadingBlock label="Loading campaigns" />
          ) : error && !data ? (
            <ErrorBlock error={error} onRetry={reload} />
          ) : (
            <>
              <Table
                columns={columns}
                rows={data.items}
                empty={
                  <EmptyState icon={LuMegaphone} title="No campaigns yet" action={newCampaign}>
                    {isManager ? 'Pick a template, choose who gets it, and send.' : 'Campaigns created by your workspace owner or admins show up here.'}
                  </EmptyState>
                }
              />
              <Pagination page={page} limit={LIMIT} total={data.total} onPage={setPage} />
            </>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
