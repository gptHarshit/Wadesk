import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { db } from './db.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { redis } from './redis.js';
import { authRouter, meRouter } from './routes/auth.js';
import { autoRepliesRouter } from './routes/autoReplies.js';
import { campaignsRouter } from './routes/campaigns.js';
import { contactsRouter, tagsRouter } from './routes/contacts.js';
import { conversationsRouter, mediaRouter } from './routes/conversations.js';
import { dashboardRouter } from './routes/dashboard.js';
import { savedRepliesRouter } from './routes/savedReplies.js';
import { settingsRouter } from './routes/settings.js';
import { teamRouter } from './routes/team.js';
import { templatesRouter } from './routes/templates.js';
import { webhooksRouter } from './routes/webhooks.js';

const tooMany = (message) => ({ error: { code: 'rate_limited', message } });

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
      // Log the path only: query strings can carry search terms and the webhook verify token.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url ?? '').split('?')[0], remoteAddress: req.remoteAddress }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Used by Docker and load balancers.
  app.get('/health', async (_req, res) => {
    try {
      await Promise.all([db.ping(), redis.ping()]);
      res.json({ status: 'ok' });
    } catch (err) {
      logger.error({ err: err.message }, 'Health check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // Meta calls these server to server: no CORS, own body parser (the raw body is needed for the signature).
  app.use('/webhooks/whatsapp', webhooksRouter);

  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: tooMany('Too many requests. Please slow down.'),
    }),
  );
  // Much stricter on the endpoints that take a password or send an email.
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany('Too many attempts. Please wait a few minutes and try again.'),
  });
  for (const path of ['/login', '/signup', '/forgot-password', '/reset-password', '/invite', '/accept-invite']) {
    app.use(`/api/auth${path}`, authLimiter);
  }

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/team', teamRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/tags', tagsRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/auto-replies', autoRepliesRouter);
  app.use('/api/saved-replies', savedRepliesRouter);
  app.use('/api/dashboard', dashboardRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
