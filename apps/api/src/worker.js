import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'bullmq';
import { config } from './config.js';
import { db } from './db.js';
import { logger } from './logger.js';
import { QUEUES, closeQueues } from './queues.js';
import { createQueueConnection, redis } from './redis.js';
import { failCampaign, failRecipient, prepareCampaign, sendCampaignMessage } from './services/campaigns.js';
import { processWebhookPayload } from './services/inbound.js';

const isLastAttempt = (job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
const exhausted = (job) => job && job.attemptsMade >= (job.opts.attempts ?? 1);

/** Start the queue workers. Returns a function that stops them gracefully. */
export function startWorkers() {
  const webhookWorker = new Worker(
    QUEUES.webhooks,
    (job) => processWebhookPayload(job.data.workspaceId, job.data.payload),
    { connection: createQueueConnection(), concurrency: 5 },
  );

  const campaignWorker = new Worker(QUEUES.campaigns, (job) => prepareCampaign(job.data.campaignId), {
    connection: createQueueConnection(),
    concurrency: 2,
  });

  const messageWorker = new Worker(
    QUEUES.campaignMessages,
    (job) => sendCampaignMessage(job.data, { isLastAttempt: isLastAttempt(job) }),
    {
      connection: createQueueConnection(),
      concurrency: config.campaignConcurrency,
      // Global send rate across all worker processes, to stay inside WhatsApp's throughput limits.
      limiter: { max: config.campaignRatePerSecond, duration: 1000 },
    },
  );

  webhookWorker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'Webhook job failed'));

  campaignWorker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Campaign preparation failed');
    if (exhausted(job)) failCampaign(job.data.campaignId, err.message).catch(() => {});
  });

  messageWorker.on('failed', (job, err) => {
    logger.warn({ err: err.message, jobId: job?.id, attempt: job?.attemptsMade }, 'Campaign send failed');
    // Out of retries after an unexpected error: close the recipient so the campaign can still finish.
    if (exhausted(job)) failRecipient(job.data.recipientId, `Could not send: ${err.message}`).catch(() => {});
  });

  for (const worker of [webhookWorker, campaignWorker, messageWorker]) {
    worker.on('error', (err) => logger.error({ err: err.message }, 'Worker error'));
  }
  logger.info('Queue workers started');

  return async function stopWorkers() {
    await Promise.allSettled([webhookWorker.close(), campaignWorker.close(), messageWorker.close()]);
  };
}

// Run directly: `node src/worker.js`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = startWorkers();
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'Worker shutting down');
    await stop();
    await closeQueues();
    await redis.quit().catch(() => {});
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
