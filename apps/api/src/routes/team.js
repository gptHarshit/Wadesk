import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { sendActionEmail } from '../lib/mailer.js';
import { email, idParam, parse } from '../lib/validate.js';
import { requireAuth, requireManager } from '../middleware/auth.js';
import { revokeAllSessions } from '../services/sessions.js';

export const teamRouter = Router();
teamRouter.use(requireAuth);

const MEMBER_COLUMNS = 'id, name, email, role, status, last_login_at, created_at';

async function createInvite(member, workspaceId, inviterName) {
  const token = randomToken(32);
  await db.exec(
    `UPDATE users SET invite_token_hash = $1, invite_expires_at = now() + make_interval(days => $2::int), updated_at = now()
      WHERE id = $3`,
    [sha256(token), config.inviteTtlDays, member.id],
  );
  const workspace = await db.one('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
  const inviteUrl = `${config.appUrl}/accept-invite?token=${encodeURIComponent(token)}`;
  const emailed = await sendActionEmail({
    to: member.email,
    subject: `${inviterName} invited you to ${workspace.name} on WaDesk`,
    intro: `${inviterName} invited you to join ${workspace.name}. The link expires in ${config.inviteTtlDays} days.`,
    actionLabel: 'Accept invite',
    actionUrl: inviteUrl,
  });
  return { inviteUrl, emailed };
}

// Everyone can see the team (agents need the list to assign chats).
teamRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const members = await db.many(
      `SELECT ${MEMBER_COLUMNS} FROM users WHERE workspace_id = $1
        ORDER BY (role = 'owner') DESC, created_at`,
      [req.user.workspaceId],
    );
    res.json({ items: members });
  }),
);

teamRouter.post(
  '/invite',
  requireManager,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({ email, name: z.string().trim().min(1).max(120), role: z.enum(['admin', 'agent']).default('agent') }),
      req.body,
    );
    if (body.role === 'admin' && req.user.role !== 'owner') throw forbidden('Only the owner can add admins');
    if (await db.one('SELECT id FROM users WHERE lower(email) = $1', [body.email])) {
      throw conflict('Someone with this email already has an account');
    }

    const member = await db.one(
      `INSERT INTO users (workspace_id, email, name, role, status)
       VALUES ($1, $2, $3, $4, 'invited') RETURNING ${MEMBER_COLUMNS}`,
      [req.user.workspaceId, body.email, body.name, body.role],
    );
    const invite = await createInvite(member, req.user.workspaceId, req.user.name);
    res.status(201).json({ member, ...invite });
  }),
);

async function loadTarget(req) {
  const { id } = parse(idParam, req.params);
  const member = await db.one(`SELECT ${MEMBER_COLUMNS} FROM users WHERE id = $1 AND workspace_id = $2`, [
    id,
    req.user.workspaceId,
  ]);
  if (!member) throw notFound('Team member');
  if (member.role === 'owner') throw forbidden('The owner cannot be changed');
  if (member.id === req.user.id) throw badRequest('You cannot change your own access');
  if (member.role === 'admin' && req.user.role !== 'owner') throw forbidden('Only the owner can manage admins');
  return member;
}

teamRouter.post(
  '/:id/invite-link',
  requireManager,
  asyncHandler(async (req, res) => {
    const member = await loadTarget(req);
    if (member.status !== 'invited') throw badRequest('This person has already joined');
    res.json(await createInvite(member, req.user.workspaceId, req.user.name));
  }),
);

teamRouter.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const member = await loadTarget(req);
    const body = parse(
      z.object({ role: z.enum(['admin', 'agent']).optional(), status: z.enum(['active', 'disabled']).optional() }),
      req.body,
    );
    if (body.role === 'admin' && req.user.role !== 'owner') throw forbidden('Only the owner can add admins');
    if (body.status && member.status === 'invited') throw badRequest('This person has not accepted their invite yet');

    const updated = await db.one(
      `UPDATE users SET role = COALESCE($1, role), status = COALESCE($2, status), updated_at = now()
        WHERE id = $3 RETURNING ${MEMBER_COLUMNS}`,
      [body.role ?? null, body.status ?? null, member.id],
    );
    if (body.status === 'disabled') await revokeAllSessions(member.id);
    res.json({ member: updated });
  }),
);

teamRouter.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const member = await loadTarget(req);
    await db.exec('DELETE FROM users WHERE id = $1', [member.id]);
    res.json({ ok: true });
  }),
);
