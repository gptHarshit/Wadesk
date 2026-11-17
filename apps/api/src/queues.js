import { Queue } from 'bullmq';
import { createQueueConnection } from './redis.js';

export const QUEUES = {
  webhooks: 'wadesk-webhooks',
  campaigns: 'wadesk-campaigns',
  campaignMessages: 'wadesk-campaign-messages',
};

const connection = createQueueConnection();
const keep = { removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } };

/** Incoming WhatsApp webhooks: acknowledged to Meta immediately, processed here. */
export const webhookQueue = new Queue(QUEUES.webhooks, {
  connection,
  defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, ...keep },
});

/** One job per campaign launch: builds the recipient list and fans out. */
export const campaignQueue = new Queue(QUEUES.campaigns, {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, ...keep },
});

/** One job per recipient. The worker applies the send rate limit. */
export const campaignMessageQueue = new Queue(QUEUES.campaignMessages, {
  connection,
  defaultJobOptions: { attempts: 4, backoff: { type: 'exponential', delay: 5000 }, ...keep },
});

export async function closeQueues() {
  await Promise.allSettled([webhookQueue.close(), campaignQueue.close(), campaignMessageQueue.close()]);
  await connection.quit().catch(() => {});
}
