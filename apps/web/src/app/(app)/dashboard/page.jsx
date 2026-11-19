'use client';

import Link from 'next/link';
import { LuCircleCheck, LuInbox, LuMegaphone, LuSmartphone, LuUsers, LuUsersRound } from 'react-icons/lu';
import { CampaignStatus } from '@/components/campaigns';
import { ErrorBlock, LoadingBlock, PageBody, PageHeader, Panel, cx } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { percent } from '@/lib/format';
import { useApi } from '@/lib/hooks';

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

function Stat({ label, value, note, href, attention }) {
  const body = (
    <>
      <p className="text-sm text-mist-600">{label}</p>
      <p className={cx('mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight', attention ? 'text-marigold-700' : 'text-mist-900')}>
        {Number(value ?? 0).toLocaleString()}
      </p>
      {note ? <p className="mt-0.5 text-sm text-mist-500">{note}</p> : null}
    </>
  );
  const className = 'block rounded-lg border border-mist-200 bg-surface px-4 py-3.5';
  return href ? (
    <Link href={href} className={cx(className, 'transition-colors hover:border-mist-300')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Messages per day for the last week: two bars a day, received and sent. */
function WeekChart({ daily }) {
  const max = Math.max(1, ...daily.flatMap((d) => [d.received, d.sent]));
  return (
    <div>
      <div className="flex h-44 items-end gap-2 sm:gap-4" role="img" aria-label="Messages received and sent per day over the last 7 days">
        {daily.map((day) => (
          <div key={day.date} className="flex h-full min-w-0 flex-1 items-end justify-center gap-1">
            {[
              { value: day.received, tone: 'bg-brand-700', name: 'received' },
              { value: day.sent, tone: 'bg-leaf-500', name: 'sent' },
            ].map((bar) => (
              <div key={bar.name} className="flex h-full w-full max-w-7 flex-col items-center justify-end" title={`${day.date}: ${bar.value} ${bar.name}`}>
                <span className="mb-1 text-xs tabular-nums text-mist-500">{bar.value || ''}</span>
                <span className={cx('w-full rounded-t', bar.tone)} style={{ height: `${Math.max(bar.value ? 3 : 1, (bar.value / max) * 82)}%`, opacity: bar.value ? 1 : 0.25 }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 border-t border-mist-200 pt-2 sm:gap-4">
        {daily.map((day) => (
          <span key={day.date} className="min-w-0 flex-1 text-center text-xs text-mist-500">
            {new Date(`${day.date}T00:00:00`).toLocaleDateString([], { weekday: 'short' })}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-sm text-mist-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-700" aria-hidden /> Received
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-leaf-500" aria-hidden /> Sent
        </span>
      </div>
    </div>
  );
}

/** Shown until the workspace is fully set up. Steps are a real sequence, so they are numbered. */
function SetupSteps({ workspace, totals, isManager }) {
  const steps = [
    { done: workspace.whatsappConnected, icon: LuSmartphone, title: 'Connect your WhatsApp number', text: 'Paste your Cloud API details from Meta.', href: '/settings', managerOnly: true },
    { done: totals.contacts > 0, icon: LuUsers, title: 'Add your contacts', text: 'Import a CSV or add them one by one.', href: '/contacts' },
    { done: totals.campaigns > 0, icon: LuMegaphone, title: 'Send your first campaign', text: 'Pick an approved template and an audience.', href: '/campaigns', managerOnly: true },
    { done: false, icon: LuUsersRound, title: 'Invite your team', text: 'Agents share the same inbox.', href: '/team', managerOnly: true, optional: true },
  ].filter((s) => isManager || !s.managerOnly);
  if (steps.filter((s) => !s.optional).every((s) => s.done)) return null;

  return (
    <Panel className="mb-6 overflow-hidden">
      <div className="border-b border-mist-200 bg-marigold-50 px-5 py-3">
        <h2 className="font-display text-lg font-semibold text-mist-900">Finish setting up</h2>
      </div>
      <ol className="divide-y divide-mist-100">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Link href={step.href} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-mist-50">
              <span
                className={cx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                  step.done ? 'bg-leaf-100 text-leaf-700' : 'bg-mist-100 text-mist-700',
                )}
              >
                {step.done ? <LuCircleCheck className="h-5 w-5" aria-label="Done" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx('block font-medium', step.done ? 'text-mist-500 line-through' : 'text-mist-900')}>{step.title}</span>
                <span className="block text-sm text-mist-600">{step.text}</span>
              </span>
              <step.icon className="h-5 w-5 shrink-0 text-mist-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export default function DashboardPage() {
  const { user, workspace, isManager } = useAuth();
  const { data, error, loading, reload } = useApi('/dashboard', { tz: tz() });

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} description={`Here’s how ${workspace.name} is doing on WhatsApp.`} />
      <PageBody>
        {loading && !data ? (
          <LoadingBlock />
        ) : error && !data ? (
          <ErrorBlock error={error} onRetry={reload} />
        ) : (
          <>
            <SetupSteps workspace={workspace} totals={data.totals} isManager={isManager} />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Open chats" value={data.totals.openConversations} note={`${data.totals.unassigned} unassigned`} href="/inbox" />
              <Stat label="Waiting for a reply" value={data.totals.unread} note="Chats with unread messages" href="/inbox" attention={data.totals.unread > 0} />
              <Stat label="Messages today" value={data.totals.receivedToday + data.totals.sentToday} note={`${data.totals.receivedToday} received, ${data.totals.sentToday} sent`} />
              <Stat label="Contacts" value={data.totals.contacts} href="/contacts" />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Panel className="p-5">
                <h2 className="mb-4 font-display text-lg font-semibold text-mist-900">Messages, last 7 days</h2>
                <WeekChart daily={data.daily} />
              </Panel>

              <Panel>
                <div className="flex items-center justify-between px-5 pt-5">
                  <h2 className="font-display text-lg font-semibold text-mist-900">Recent campaigns</h2>
                  <Link href="/campaigns" className="text-sm font-medium text-brand-500 underline-offset-2 hover:underline">
                    See all
                  </Link>
                </div>
                {data.recentCampaigns.length ? (
                  <ul className="mt-2 divide-y divide-mist-100">
                    {data.recentCampaigns.map((campaign) => (
                      <li key={campaign.id}>
                        <Link href={`/campaigns/${campaign.id}`} className="block px-5 py-3 transition-colors hover:bg-mist-50">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-mist-900">{campaign.name}</span>
                            <CampaignStatus status={campaign.status} />
                          </span>
                          <span className="mt-0.5 block text-sm text-mist-600">
                            {campaign.stats.total
                              ? `${campaign.stats.sent.toLocaleString()} sent, ${percent(campaign.stats.delivered, campaign.stats.sent)}% delivered, ${percent(campaign.stats.read, campaign.stats.sent)}% read`
                              : 'Not sent yet'}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-col items-center px-5 py-10 text-center text-mist-600">
                    <LuInbox className="h-6 w-6 text-mist-400" aria-hidden />
                    <p className="mt-2">No campaigns yet.</p>
                  </div>
                )}
              </Panel>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
