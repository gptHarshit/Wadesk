'use client';

import { useMemo, useState } from 'react';
import { LuFileText, LuRefreshCw, LuSearch } from 'react-icons/lu';
import { TemplatePreview, TemplateStatus, emptyVariables } from '@/components/templates';
import { Badge, Button, EmptyState, ErrorBlock, LoadingBlock, Modal, Notice, PageBody, PageHeader, Panel, Table, useFeedback } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, plural } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export default function TemplatesPage() {
  const { isManager, workspace } = useAuth();
  const { toast } = useFeedback();
  const { data, error, loading, reload } = useApi('/templates');
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState(null);

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.items ?? []).filter((t) => !term || t.name.toLowerCase().includes(term) || t.info.body.text.toLowerCase().includes(term));
  }, [data, search]);

  async function sync() {
    setSyncing(true);
    try {
      const result = await api('/templates/sync', { method: 'POST' });
      toast.success(`${plural(result.synced, 'template')} synced from WhatsApp`);
      await reload({ quiet: true });
    } catch (err) {
      toast.error(err);
    } finally {
      setSyncing(false);
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Template',
      render: (t) => (
        <button type="button" onClick={() => setPreview(t)} className="block max-w-md text-left">
          <span className="font-medium text-mist-900 underline-offset-2 hover:underline">{t.name}</span>
          <span className="mt-0.5 line-clamp-2 text-sm text-mist-600">{t.info.body.text}</span>
        </button>
      ),
    },
    { key: 'status', header: 'Status', render: (t) => <TemplateStatus status={t.status} /> },
    { key: 'category', header: 'Category', render: (t) => <span className="text-sm capitalize text-mist-700">{(t.category || '—').toLowerCase()}</span> },
    { key: 'language', header: 'Language', render: (t) => <span className="text-sm text-mist-700">{t.language}</span> },
    {
      key: 'variables',
      header: 'Variables',
      render: (t) => {
        const count = t.info.body.params.length + (t.info.header?.params.length ?? 0) + t.info.buttons.filter((b) => b.needsParam).length;
        return t.info.sendable ? <span className="text-sm text-mist-700">{count || 'None'}</span> : <Badge tone="amber">Not supported here</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Templates"
        description={data?.lastSyncedAt ? `Last synced ${formatDateTime(data.lastSyncedAt)}` : 'Message templates approved by WhatsApp'}
        actions={
          isManager ? (
            <Button icon={LuRefreshCw} onClick={sync} loading={syncing} disabled={!workspace.whatsappConnected}>
              Sync from WhatsApp
            </Button>
          ) : null
        }
      />
      <PageBody>
        <Notice tone="blue" className="mb-4">
          Templates are written and approved in WhatsApp Manager (business.facebook.com). Sync to bring the latest list and approval status here.
        </Notice>
        {!workspace.whatsappConnected ? (
          <Notice tone="amber" className="mb-4" title="WhatsApp isn’t connected yet">
            Connect your number in Settings, then sync your templates.
          </Notice>
        ) : null}

        {data?.items.length ? (
          <div className="relative mb-4 max-w-sm">
            <LuSearch className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-mist-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates"
              aria-label="Search templates"
              className="h-10 w-full rounded-md border border-mist-300 bg-surface pl-9 pr-3 placeholder:text-mist-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        ) : null}

        <Panel>
          {loading && !data ? (
            <LoadingBlock label="Loading templates" />
          ) : error && !data ? (
            <ErrorBlock error={error} onRetry={reload} />
          ) : (
            <Table
              columns={columns}
              rows={items}
              empty={
                data.items.length ? (
                  <EmptyState icon={LuSearch} title="No templates match">
                    Nothing matches “{search}”.
                  </EmptyState>
                ) : (
                  <EmptyState
                    icon={LuFileText}
                    title="No templates here yet"
                    action={
                      isManager && workspace.whatsappConnected ? (
                        <Button icon={LuRefreshCw} onClick={sync} loading={syncing}>
                          Sync from WhatsApp
                        </Button>
                      ) : null
                    }
                  >
                    Sync to load the templates from your WhatsApp Business Account.
                  </EmptyState>
                )
              }
            />
          )}
        </Panel>
      </PageBody>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.name ?? ''} description={preview ? `${preview.language}, ${(preview.category || '').toLowerCase()}` : undefined}>
        {preview ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <TemplateStatus status={preview.status} />
              {!preview.info.sendable ? <span className="text-sm text-marigold-800">{preview.info.reason}</span> : null}
            </div>
            <TemplatePreview template={preview} variables={emptyVariables()} />
          </div>
        ) : null}
      </Modal>
    </>
  );
}
