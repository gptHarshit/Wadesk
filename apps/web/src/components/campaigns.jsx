'use client';

import { Badge } from './ui';

const STATUS = {
  draft: { tone: 'neutral', label: 'Draft' },
  scheduled: { tone: 'blue', label: 'Scheduled' },
  queued: { tone: 'amber', label: 'Starting' },
  sending: { tone: 'amber', label: 'Sending' },
  completed: { tone: 'green', label: 'Completed' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  failed: { tone: 'red', label: 'Failed' },
};

export function CampaignStatus({ status }) {
  const item = STATUS[status] ?? { tone: 'neutral', label: status };
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

export const isRunning = (status) => status === 'queued' || status === 'sending';

/** One bar showing how far a campaign got: read inside delivered inside sent, then failed. */
export function CampaignProgress({ stats }) {
  const total = stats.total || 1;
  const part = (n) => `${(n / total) * 100}%`;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-mist-200" role="img" aria-label={`${stats.sent} of ${stats.total} sent, ${stats.failed} failed`}>
      <span className="bg-leaf-700" style={{ width: part(stats.read) }} />
      <span className="bg-leaf-500" style={{ width: part(stats.delivered - stats.read) }} />
      <span className="bg-leaf-200" style={{ width: part(stats.sent - stats.delivered) }} />
      <span className="bg-brick-600" style={{ width: part(stats.failed) }} />
    </div>
  );
}
