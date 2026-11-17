import Redis from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

function attachLogging(client, name) {
  client.on('error', (err) => logger.error({ err: err.message, client: name }, 'Redis error'));
  return client;
}

/** General-purpose connection (commands and publishing). */
export const redis = attachLogging(new Redis(config.redisUrl, { maxRetriesPerRequest: 3 }), 'main');

/** Dedicated connection for pub/sub subscriptions. */
export const createSubscriber = () => attachLogging(new Redis(config.redisUrl), 'subscriber');

/** BullMQ needs `maxRetriesPerRequest: null` on its connections. */
export const createQueueConnection = () =>
  attachLogging(new Redis(config.redisUrl, { maxRetriesPerRequest: null }), 'queue');
