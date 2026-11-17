import { db } from '../db.js';
import { asyncHandler, forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../services/sessions.js';

/**
 * Require a valid access token. The user row is re-read on every request so a
 * disabled account or a changed role takes effect immediately.
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) throw unauthorized();

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw unauthorized('Session expired');
  }

  const user = await db.one('SELECT id, workspace_id, name, email, role, status FROM users WHERE id = $1', [claims.sub]);
  if (!user || user.status !== 'active') throw unauthorized('Account is not active');

  req.user = user;
  next();
});

/** Allow only the given roles (use after requireAuth). */
export const requireRole =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user?.role) ? next() : next(forbidden());

export const requireManager = requireRole('owner', 'admin');
