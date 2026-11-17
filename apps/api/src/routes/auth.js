import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { asyncHandler, badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { sendActionEmail } from '../lib/mailer.js';
import { email, parse, password } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  REFRESH_COOKIE,
  clearSessionCookie,
  loadProfile,
  revokeAllSessions,
  revokeRefreshToken,
  startSession,
} from '../services/sessions.js';

export const authRouter = Router();
export const meRouter = Router();

const BCRYPT_ROUNDS = 12;
// Compared against when the account doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const name = z.string().trim().min(1, 'Name is required').max(120);

authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    if (!config.allowSignup) throw forbidden('Sign up is disabled on this server');
    const body = parse(
      z.object({ name, email, password, workspaceName: z.string().trim().min(1, 'Business name is required').max(120) }),
      req.body,
    );
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

    const user = await db.tx(async (t) => {
      if (await t.one('SELECT id FROM users WHERE lower(email) = $1', [body.email])) {
        throw conflict('An account with this email already exists');
      }
      const workspace = await t.one('INSERT INTO workspaces (name, webhook_verify_token) VALUES ($1, $2) RETURNING id', [
        body.workspaceName,
        randomToken(24),
      ]);
      return t.one(
        `INSERT INTO users (workspace_id, email, name, password_hash, role, last_login_at)
         VALUES ($1, $2, $3, $4, 'owner', now())
         RETURNING id, workspace_id, role`,
        [workspace.id, body.email, body.name, passwordHash],
      );
    });

    res.status(201).json(await startSession(req, res, user));
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
    const user = await db.one(
      'SELECT id, workspace_id, role, status, password_hash FROM users WHERE lower(email) = $1',
      [body.email],
    );
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) throw unauthorized('Incorrect email or password');
    if (user.status !== 'active') throw forbidden('This account has been disabled. Ask your workspace owner.');

    await db.exec('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    res.json(await startSession(req, res, user));
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw unauthorized('Not signed in');

    const row = await db.one(
      `SELECT rt.id, rt.expires_at, rt.revoked_at, u.id AS user_id, u.workspace_id, u.role, u.status
         FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1`,
      [sha256(token)],
    );
    if (!row || row.revokedAt || row.expiresAt < new Date() || row.status !== 'active') {
      clearSessionCookie(res);
      throw unauthorized('Session expired');
    }

    // Rotate: each refresh token is single use.
    await db.exec('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
    res.json(await startSession(req, res, { id: row.userId, workspaceId: row.workspaceId, role: row.role }));
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ email }), req.body);
    const user = await db.one(`SELECT id, email FROM users WHERE lower(email) = $1 AND status = 'active'`, [body.email]);

    if (user) {
      const token = randomToken(32);
      await db.exec(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3::int))`,
        [user.id, sha256(token), config.resetTtlMinutes],
      );
      await sendActionEmail({
        to: user.email,
        subject: 'Reset your WaDesk password',
        intro: `Use the link below to choose a new password. It expires in ${config.resetTtlMinutes} minutes.`,
        actionLabel: 'Reset password',
        actionUrl: `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
      });
    }
    // Same response either way, so this endpoint can't be used to find registered emails.
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

    const userId = await db.tx(async (t) => {
      const reset = await t.one(
        `UPDATE password_resets SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [sha256(body.token)],
      );
      if (!reset) throw badRequest('This reset link is invalid or has expired. Request a new one.');
      await t.exec('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, reset.userId]);
      return reset.userId;
    });

    await revokeAllSessions(userId);
    res.json({ ok: true });
  }),
);

// The token travels in the body, not the URL, so it never ends up in request logs.
authRouter.post(
  '/invite',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const invite = await db.one(
      `SELECT u.email, u.name, w.name AS workspace_name
         FROM users u JOIN workspaces w ON w.id = u.workspace_id
        WHERE u.invite_token_hash = $1 AND u.status = 'invited' AND u.invite_expires_at > now()`,
      [sha256(body.token)],
    );
    if (!invite) throw badRequest('This invite link is invalid or has expired. Ask for a new one.');
    res.json(invite);
  }),
);

authRouter.post(
  '/accept-invite',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), name, password }), req.body);
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const user = await db.one(
      `UPDATE users
          SET name = $1, password_hash = $2, status = 'active', invite_token_hash = NULL,
              invite_expires_at = NULL, last_login_at = now(), updated_at = now()
        WHERE invite_token_hash = $3 AND status = 'invited' AND invite_expires_at > now()
        RETURNING id, workspace_id, role`,
      [body.name, passwordHash, sha256(body.token)],
    );
    if (!user) throw badRequest('This invite link is invalid or has expired. Ask for a new one.');
    res.status(201).json(await startSession(req, res, user));
  }),
);

/* ---- Current user ---- */

meRouter.use(requireAuth);

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await loadProfile(req.user.id));
  }),
);

meRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ name }), req.body);
    await db.exec('UPDATE users SET name = $1, updated_at = now() WHERE id = $2', [body.name, req.user.id]);
    res.json(await loadProfile(req.user.id));
  }),
);

meRouter.post(
  '/password',
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }), req.body);
    const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(body.currentPassword, row.passwordHash ?? DUMMY_HASH))) {
      throw badRequest('Current password is incorrect');
    }
    await db.exec('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      await bcrypt.hash(body.newPassword, BCRYPT_ROUNDS),
      req.user.id,
    ]);
    // Sign out every other device, then start a fresh session for this one.
    await revokeAllSessions(req.user.id);
    res.json(await startSession(req, res, req.user));
  }),
);
