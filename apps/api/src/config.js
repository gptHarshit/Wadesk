import 'dotenv/config';
import { z } from 'zod';

const flag = (fallback) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const optional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  // Where the web app is served (used for CORS and links in emails).
  APP_URL: z.string().url().default('http://localhost:3000'),
  // Extra allowed origins, comma separated.
  CORS_ORIGINS: optional,
  // Public HTTPS address of this API (shown as the webhook URL to paste into Meta).
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  TRUST_PROXY: z.string().default('false'),
  COOKIE_SECURE: flag(undefined),
  COOKIE_DOMAIN: optional,
  // Use "none" only when the web app and API are on different sites (needs HTTPS).
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  ALLOW_SIGNUP: flag(true),

  META_GRAPH_BASE_URL: z.string().url().default('https://graph.facebook.com'),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v24.0'),

  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(16),

  CAMPAIGN_RATE_PER_SECOND: z.coerce.number().int().positive().default(20),
  CAMPAIGN_CONCURRENCY: z.coerce.number().int().positive().default(10),
  // Run queue workers inside the API process (handy for single-service hosting).
  EMBEDDED_WORKER: flag(false),

  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  MAIL_FROM: z.string().default('WaDesk <no-reply@localhost>'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || 'env'}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;
const stripSlash = (url) => url.replace(/\/+$/, '');

function parseTrustProxy(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  return Number.isInteger(n) ? n : value;
}

export const config = Object.freeze({
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,

  databaseUrl: env.DATABASE_URL,
  databasePoolMax: env.DATABASE_POOL_MAX,
  redisUrl: env.REDIS_URL,

  jwtSecret: env.JWT_SECRET,
  encryptionKey: env.ENCRYPTION_KEY,
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 30,
  inviteTtlDays: 7,
  resetTtlMinutes: 60,

  appUrl: stripSlash(env.APP_URL),
  corsOrigins: [
    stripSlash(env.APP_URL),
    ...(env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map((s) => stripSlash(s.trim())).filter(Boolean) : []),
  ],
  apiPublicUrl: stripSlash(env.API_PUBLIC_URL),
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  cookieDomain: env.COOKIE_DOMAIN,
  cookieSameSite: env.COOKIE_SAMESITE,
  allowSignup: env.ALLOW_SIGNUP,

  metaGraphBaseUrl: stripSlash(env.META_GRAPH_BASE_URL),
  metaGraphVersion: env.META_GRAPH_VERSION,

  storageDir: env.STORAGE_DIR,
  maxUploadBytes: Math.round(env.MAX_UPLOAD_MB * 1024 * 1024),

  campaignRatePerSecond: env.CAMPAIGN_RATE_PER_SECOND,
  campaignConcurrency: env.CAMPAIGN_CONCURRENCY,
  embeddedWorker: env.EMBEDDED_WORKER,

  smtp: env.SMTP_HOST
    ? { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS }
    : null,
  mailFrom: env.MAIL_FROM,
});
