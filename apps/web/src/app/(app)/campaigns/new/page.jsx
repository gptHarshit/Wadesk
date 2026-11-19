'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { LuArrowLeft, LuCircleAlert, LuCircleCheck } from 'react-icons/lu';
import { BUILT_IN_FIELDS, fieldLabel } from '@/components/fields';
import { TemplatePreview, TemplateVariablesForm, emptyVariables } from '@/components/templates';
import { Button, ErrorBlock, Input, LoadingBlock, Notice, PageBody, PageHeader, Panel, Select, cx } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { plural } from '@/lib/format';
import { useApi } from '@/lib/hooks';

const SAMPLE_CONTACT = { name: 'Anil Kumar', phone: '919876543210', email: 'anil@example.com' };

/** Dry run against the real audience: rendered messages for a few people, and who is missing data. */
function CampaignCheck({ check, checking }) {
  if (!check && !checking) return null;
  if (!check) return <p className="text-sm text-mist-500">Checking your contacts…</p>;
  if (check.error) return <Notice tone="red">{check.error}</Notice>;
  const missing = Object.entries(check.missingByField ?? {}).filter(([, n]) => n > 0);
  return (
    <div className="space-y-3" aria-live="polite">
      {check.failing ? (
        <Notice tone="amber" title={`${plural(check.failing, 'contact')} will not get this message`}>
          {missing.length ? (
            <p>
              Missing data:{' '}
              {missing.map(([key, n], i) => (
                <span key={key}>
                  {i ? ', ' : ''}
                  <strong>{fieldLabel(key)}</strong> for {plural(n, 'contact')}
                </span>
              ))}
              . Add the data (or re-import the CSV), or give the field a fallback like {'{{'}
              {missing[0][0]}|NA{'}}'}.
            </p>
          ) : null}
          {check.problems?.length ? (
            <ul className="mt-1 list-disc pl-4 text-sm">
              {check.problems.slice(0, 5).map((p) => (
                <li key={p.id}>
                  {p.name || formatPhone(p.phone)}: {p.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : check.total ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-leaf-700">
          <LuCircleCheck className="h-4 w-4" aria-hidden />
          All {plural(check.total, 'contact')} have the data this message needs.
        </p>
      ) : null}
      {check.samples?.length ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-mist-700">What real contacts will receive</p>
          {check.samples.map((s) => (
            <div key={s.id} className="rounded-lg border border-mist-200 bg-surface px-3 py-2">
              <p className="text-xs font-medium text-mist-500">{s.name || formatPhone(s.phone)}</p>
              <p className="whitespace-pre-wrap text-sm text-mist-900">{s.text}</p>
            </div>
          ))}
        </div>
      ) : null}
      {check.truncated ? (
        <p className="flex items-center gap-1.5 text-xs text-mist-500">
          <LuCircleAlert className="h-3.5 w-3.5" aria-hidden />
          Only the first 50,000 contacts were checked.
        </p>
      ) : null}
    </div>
  );
}

function AudienceOption({ checked, onSelect, title, children }) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
        checked ? 'border-brand-500 bg-brand-50' : 'border-mist-300 bg-surface hover:bg-mist-50',
      )}
    >
      <input type="radio" name="audience" checked={checked} onChange={onSelect} className="mt-1 h-4 w-4 accent-brand-600" />
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
  const fieldData = useApi('/contacts/fields');
  const fields = useMemo(() => [...BUILT_IN_FIELDS, ...(fieldData.data?.items ?? []).map((f) => f.key)], [fieldData.data]);
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
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

  // Dry run against real contacts whenever the message or audience changes.
  useEffect(() => {
    if (!templateId || !audienceReady) {
      setCheck(null);
      return undefined;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      api('/campaigns/preview', { method: 'POST', body: { templateId, variables, audience } })
        .then((res) => !cancelled && setCheck(res))
        // A 400 here usually means a variable is still empty; the form shows that, so stay quiet.
        .catch((err) => !cancelled && setCheck(err.status === 400 ? null : { error: err.message }))
        .finally(() => !cancelled && setChecking(false));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [templateId, variables, audience, audienceReady]);

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
    <Link href="/campaigns" className="inline-flex h-10 items-center gap-2 rounded-md border border-mist-300 bg-surface px-4 font-medium text-mist-800 hover:bg-mist-50">
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
                {template ? <TemplateVariablesForm template={template} value={variables} onChange={setVariables} fields={fields} /> : null}
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
                              on ? 'border-brand-600 bg-brand-600 text-white' : 'border-mist-300 bg-surface text-mist-700 hover:bg-mist-50',
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
                <div className="mt-4">
                  <CampaignCheck check={check} checking={checking} />
                </div>
              </div>
            </div>
          </form>
        )}
      </PageBody>
    </>
  );
}
