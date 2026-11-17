import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { logger } from './logger.js';
import { closeQueues } from './queues.js';
import { attachRealtime } from './realtime.js';
import { redis } from './redis.js';

const server = http.createServer(createApp());
const realtime = attachRealtime(server);

// Optionally run the queue workers in this process (single-service hosting).
let stopWorkers = null;
if (config.embeddedWorker) {
  const { startWorkers } = await import('./worker.js');
  stopWorkers = startWorkers();
}

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env, embeddedWorker: config.embeddedWorker }, 'WaDesk API listening');
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'API shutting down');
  // Stop taking new work, let in-flight requests finish, then close connections.
  const forced = setTimeout(() => {
    logger.error('Shutdown timed out; exiting');
    process.exit(1);
  }, 15_000);
  forced.unref();

  await realtime.close();
  await new Promise((resolve) => server.close(() => resolve()));
  if (stopWorkers) await stopWorkers();
  await closeQueues();
  await redis.quit().catch(() => {});
  await db.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});
