import { Server } from 'socket.io';
import { config } from './config.js';
import { db } from './db.js';
import { logger } from './logger.js';
import { createSubscriber, redis } from './redis.js';
import { verifyAccessToken } from './services/sessions.js';

/**
 * Real-time updates.
 *
 * Any process (API or worker) calls `publish()`, which goes through a Redis
 * channel. Every API instance subscribes and forwards events to the sockets
 * connected to it, so this works with several API instances behind a load
 * balancer and with workers in a separate process.
 */
const CHANNEL = 'wadesk:realtime';
const room = (workspaceId) => `ws:${workspaceId}`;

export async function publish(workspaceId, event, data) {
  try {
    await redis.publish(CHANNEL, JSON.stringify({ workspaceId, event, data }));
  } catch (err) {
    logger.warn({ err: err.message, event }, 'Failed to publish realtime event');
  }
}

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const claims = verifyAccessToken(String(socket.handshake.auth?.token ?? ''));
      const user = await db.one('SELECT id, workspace_id, status FROM users WHERE id = $1', [claims.sub]);
      if (!user || user.status !== 'active') return next(new Error('unauthorized'));
      socket.data.user = user;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(room(socket.data.user.workspaceId));
  });

  const subscriber = createSubscriber();
  subscriber.subscribe(CHANNEL).catch((err) => logger.error({ err: err.message }, 'Realtime subscribe failed'));
  subscriber.on('message', (_channel, raw) => {
    try {
      const { workspaceId, event, data } = JSON.parse(raw);
      io.to(room(workspaceId)).emit(event, data);
    } catch (err) {
      logger.warn({ err: err.message }, 'Bad realtime payload');
    }
  });

  return {
    io,
    async close() {
      await subscriber.quit().catch(() => {});
      await new Promise((resolve) => io.close(() => resolve()));
    },
  };
}
