import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { asyncHandler, badRequest, conflict } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireAuth, requireManager } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { WhatsAppError, fetchPhoneNumber, subscribeApp } from '../services/whatsapp.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireManager);

/* ---- Workspace profile ---- */

settingsRouter.get(
  '/workspace',
  asyncHandler(async (req, res) => {
    res.json(await db.one('SELECT id, name, default_country_code, created_at FROM workspaces WHERE id = $1', [req.user.workspaceId]));
  }),
);

settingsRouter.patch(
  '/workspace',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120),
        defaultCountryCode: z
          .string()
          .trim()
          .regex(/^\+?\d{1,4}$/, 'Use digits only, for example 91')
          .transform((v) => v.replace('+', ''))
          .nullable()
          .optional(),
      }),
      req.body,
    );
    const workspace = await db.one(
      `UPDATE workspaces SET name = $1, default_country_code = $2, updated_at = now()
        WHERE id = $3 RETURNING id, name, default_country_code, created_at`,
      [body.name, body.defaultCountryCode ?? null, req.user.workspaceId],
    );
    res.json(workspace);
  }),
);

/* ---- WhatsApp connection ---- */

async function describeConnection(workspaceId) {
  const row = await db.one(
    `SELECT w.webhook_verify_token, wa.phone_number_id, wa.waba_id, wa.access_token_enc,
            wa.display_phone_number, wa.verified_name, wa.connected_at
       FROM workspaces w LEFT JOIN whatsapp_accounts wa ON wa.workspace_id = w.id
      WHERE w.id = $1`,
    [workspaceId],
  );
  return {
    connected: Boolean(row.phoneNumberId),
    phoneNumberId: row.phoneNumberId,
    wabaId: row.wabaId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    connectedAt: row.connectedAt,
    // Never send the token back; the last characters are enough to recognise it.
    accessTokenHint: row.accessTokenEnc ? `…${decrypt(row.accessTokenEnc).slice(-4)}` : null,
    webhookUrl: `${config.apiPublicUrl}/webhooks/whatsapp/${workspaceId}`,
    verifyToken: row.webhookVerifyToken,
    graphVersion: config.metaGraphVersion,
  };
}

settingsRouter.get(
  '/whatsapp',
  asyncHandler(async (req, res) => {
    res.json(await describeConnection(req.user.workspaceId));
  }),
);

settingsRouter.put(
  '/whatsapp',
  asyncHandler(async (req, res) => {
    const numeric = (label) => z.string().trim().regex(/^\d{5,30}$/, `${label} should be a number from Meta`);
    const secret = z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => v || undefined);
    const body = parse(
      z.object({
        phoneNumberId: numeric('Phone number ID'),
        wabaId: numeric('WhatsApp Business Account ID'),
        accessToken: secret,
        appSecret: secret,
      }),
      req.body,
    );

    const existing = await db.one('SELECT access_token_enc, app_secret_enc FROM whatsapp_accounts WHERE workspace_id = $1', [
      req.user.workspaceId,
    ]);
    // Secrets may be left blank when editing to keep the stored ones.
    const accessToken = body.accessToken ?? (existing ? decrypt(existing.accessTokenEnc) : null);
    const appSecret = body.appSecret ?? (existing ? decrypt(existing.appSecretEnc) : null);
    if (!accessToken) throw badRequest('Access token is required');
    if (!appSecret) throw badRequest('App secret is required (it is used to verify incoming webhooks)');

    const account = { phoneNumberId: body.phoneNumberId, wabaId: body.wabaId, accessToken };

    // Check the credentials really work before saving them.
    let phone;
    try {
      phone = await fetchPhoneNumber(account);
    } catch (err) {
      if (err instanceof WhatsAppError) {
        throw badRequest(`Meta rejected these credentials: ${err.message}`);
      }
      throw err;
    }

    let webhookSubscribed = true;
    try {
      await subscribeApp(account);
    } catch (err) {
      webhookSubscribed = false;
      logger.warn({ err: err.message, workspaceId: req.user.workspaceId }, 'Could not subscribe app to WABA');
    }

    try {
      await db.exec(
        `INSERT INTO whatsapp_accounts
           (workspace_id, phone_number_id, waba_id, access_token_enc, app_secret_enc, display_phone_number, verified_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id) DO UPDATE SET
           phone_number_id = EXCLUDED.phone_number_id, waba_id = EXCLUDED.waba_id,
           access_token_enc = EXCLUDED.access_token_enc, app_secret_enc = EXCLUDED.app_secret_enc,
           display_phone_number = EXCLUDED.display_phone_number, verified_name = EXCLUDED.verified_name,
           updated_at = now()`,
        [
          req.user.workspaceId,
          body.phoneNumberId,
          body.wabaId,
          encrypt(accessToken),
          encrypt(appSecret),
          phone.display_phone_number ?? null,
          phone.verified_name ?? null,
        ],
      );
    } catch (err) {
      if (err.code === '23505') throw conflict('This WhatsApp number is already connected to another workspace');
      throw err;
    }

    res.json({ ...(await describeConnection(req.user.workspaceId)), webhookSubscribed });
  }),
);

settingsRouter.delete(
  '/whatsapp',
  asyncHandler(async (req, res) => {
    await db.exec('DELETE FROM whatsapp_accounts WHERE workspace_id = $1', [req.user.workspaceId]);
    res.json(await describeConnection(req.user.workspaceId));
  }),
);
