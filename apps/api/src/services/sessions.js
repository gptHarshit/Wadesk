import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';

export const REFRESH_COOKIE = 'wd_refresh';

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: config.cookieSameSite,
  path: '/api/auth',
  domain: config.cookieDomain,
});

export function signAccessToken(user) {
  return jwt.sign({ ws: user.workspaceId, role: user.role }, config.jwtSecret, {
    subject: user.id,
    expiresIn: config.accessTokenTtlSeconds,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

/** What the web app needs to know about the signed-in user and their workspace. */
export async function loadProfile(userId) {
  const row = await db.one(
    `SELECT u.id, u.name, u.email, u.role, u.status,
            w.id AS workspace_id, w.name AS workspace_name, w.default_country_code,
            (wa.workspace_id IS NOT NULL) AS whatsapp_connected
       FROM users u
       JOIN workspaces w ON w.id = u.workspace_id
       LEFT JOIN whatsapp_accounts wa ON wa.workspace_id = w.id
      WHERE u.id = $1`,
    [userId],
  );
  if (!row) return null;
  return {
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
    workspace: {
      id: row.workspaceId,
      name: row.workspaceName,
      defaultCountryCode: row.defaultCountryCode,
      whatsappConnected: row.whatsappConnected,
    },
  };
}

/** Create a refresh token, set it as an httpOnly cookie, and return the session payload. */
export async function startSession(req, res, user) {
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000);
  await db.exec(
    'INSERT INTO refresh_tokens (user_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, $4)',
    [user.id, sha256(refreshToken), String(req.headers['user-agent'] ?? '').slice(0, 300) || null, expiresAt],
  );
  res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions(), expires: expiresAt });

  const profile = await loadProfile(user.id);
  return {
    accessToken: signAccessToken(user),
    expiresIn: config.accessTokenTtlSeconds,
    ...profile,
  };
}

export function clearSessionCookie(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  await db.exec('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    sha256(token),
  ]);
}

export async function revokeAllSessions(userId) {
  await db.exec('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}
