'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { LuArrowLeft } from 'react-icons/lu';
import { TemplatePreview, TemplateVariablesForm, emptyVariables } from '@/components/templates';
import { Button, ErrorBlock, Input, LoadingBlock, Notice, PageBody, PageHeader, Panel, Select, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { plural } from '@/lib/format';
import { useApi } from '@/lib/hooks';

const SAMPLE_CONTACT = { name: 'Anil Kumar', phone: '919876543210', email: 'anil@example.com' };

function AudienceOption({ checked, onSelect, title, children }) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
        checked ? 'border-leaf-600 bg-leaf-50' : 'border-mist-300 bg-white hover:bg-mist-50',
      )}
    >
      <input type="radio" name="audience" checked={checked} onChange={onSelect} className="mt-1 h-4 w-4 accent-leaf-600" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-mist-900">{title}</span>
        {children}
      </span>
    </label>
  );
}

export default function NewCampaignPage() {
  const router = useRouter();
  const { isManager, workspace } = useAuth();
  const templates = useApi('/templates', { status: 'APPROVED' });
  const tags = useApi('/tags');
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [variables, setVariables] = useState(emptyVariables);
  const [audienceType, setAudienceType] = useState('all');
  const [tagIds, setTagIds] = useState([]);
  const [count, setCount] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const usable = useMemo(() => (templates.data?.items ?? []).filter((t) => t.info.sendable), [templates.data]);
  const template = usable.find((t) => t.id === templateId) ?? null;
  const audience = useMemo(() => (audienceType === 'all' ? { type: 'all' } : { type: 'tags', tagIds }), [audienceType, tagIds]);
  const audienceReady = audienceType === 'all' || tagIds.length > 0;

  // Live count of who would receive this.
  useEffect(() => {
    if (!audienceReady) {
      setCount(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api('/campaigns/audience-count', { method: 'POST', body: { audience } })
        .then((res) => !cancelled && setCount(res.count))
        .catch(() => !cancelled && setCount(null));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audience, audienceReady]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const campaign = await api('/campaigns', { method: 'POST', body: { name, templateId, variables, audience } });
      router.push(`/campaigns/${campaign.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
      window.scrollTo?.({ top: 0 });
    }
  }

  const back = (
    <Link href="/campaigns" className="inline-flex h-10 items-center gap-2 rounded-md border border-mist-300 bg-white px-4 font-medium text-mist-800 hover:bg-mist-50">
      <LuArrowLeft className="h-4 w-4" aria-hidden />
      All campaigns
    </Link>
  );

  if (!isManager) {
    return (
      <>
        <PageHeader title="New campaign" actions={back} />
        <PageBody>
          <Notice tone="amber" title="Only owners and admins can create campaigns" />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader title="New campaign" description="You’ll get a chance to review everything before anything is sent." actions={back} />
      <PageBody>
        {templates.loading || tags.loading ? (
          <LoadingBlock />
        ) : templates.error ? (
          <ErrorBlock error={templates.error} onRetry={templates.reload} />
        ) : !usable.length ? (
          <Notice tone="amber" title="You need an approved template first">
            {workspace.whatsappConnected
              ? 'Create a template in WhatsApp Manager, wait for approval, then sync it on the Templates page.'
              : 'Connect your WhatsApp number in Settings, then sync your templates.'}
          </Notice>
        ) : (
          <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]" noValidate>
            <div className="space-y-6">
              {error ? <Notice tone="red">{error.message}</Notice> : null}

              <Panel className="space-y-4 p-5">
                <h2 className="font-display text-lg font-semibold text-mist-900">Message</h2>
                <Input label="Campaign name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali offer, November" hint="Only your team sees this." maxLength={120} />
                <Select
                  label="Template"
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    setVariables(emptyVariables());
                  }}
                >
                  <option value="">Choose a template…</option>
                  {usable.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.language})
                    </option>
                  ))}
                </Select>
                {template ? <TemplateVariablesForm template={template} value={variables} onChange={setVariables} /> : null}
              </Panel>

              <Panel className="space-y-3 p-5">
                <h2 className="font-display text-lg font-semibold text-mist-900">Who gets it</h2>
                <AudienceOption checked={audienceType === 'all'} onSelect={() => setAudienceType('all')} title="All contacts" />
                <AudienceOption checked={audienceType === 'tags'} onSelect={() => setAudienceType('tags')} title="Contacts with any of these tags">
                  {audienceType === 'tags' ? (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {(tags.data?.items ?? []).map((tag) => {
                        const on = tagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            onClick={() => setTagIds(on ? tagIds.filter((id) => id !== tag.id) : [...tagIds, tag.id])}
                            className={cx(
                              'rounded-full border px-2.5 py-1 text-sm font-medium',
                              on ? 'border-leaf-600 bg-leaf-600 text-white' : 'border-mist-300 bg-white text-mist-700 hover:bg-mist-50',
                            )}
                          >
                            {tag.name} ({tag.contactCount})
                          </button>
                        );
                      })}
                      {!tags.data?.items.length ? <span className="text-sm text-mist-500">No tags yet. Add some on the Contacts page.</span> : null}
                    </span>
                  ) : null}
                </AudienceOption>
                <p className="text-mist-700" aria-live="polite">
                  {count === null ? (
                    audienceReady ? 'Counting contacts…' : 'Pick at least one tag.'
                  ) : (
                    <>
                      <strong className="text-mist-900">{plural(count, 'contact')}</strong> will receive this. Contacts who opted out are left out.
                    </>
                  )}
                </p>
              </Panel>

              <div className="flex justify-end">
                <Button type="submit" loading={busy} disabled={!name.trim() || !template || !audienceReady}>
                  Save and review
                </Button>
              </div>
            </div>

            <div>
              <div className="xl:sticky xl:top-6">
                <p className="mb-2 text-sm font-medium text-mist-700">Preview{template ? `, as ${SAMPLE_CONTACT.name} would see it` : ''}</p>
                {template ? (
                  <TemplatePreview template={template} variables={variables} contact={SAMPLE_CONTACT} />
                ) : (
                  <div className="thread-surface flex h-40 items-center justify-center rounded-lg text-mist-500">Choose a template to see it here</div>
                )}
              </div>
            </div>
          </form>
        )}
      </PageBody>
    </>
  );
}
