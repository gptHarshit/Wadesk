import express, { Router } from 'express';
import { db } from '../db.js';
import { safeEqual, verifyMetaSignature } from '../lib/crypto.js';
import { asyncHandler } from '../lib/errors.js';
import { logger } from '../logger.js';
import { webhookQueue } from '../queues.js';
import { getAccount } from '../services/whatsapp.js';

export const webhooksRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Meta's verification handshake. When you save the webhook URL in the Meta app
 * dashboard, Meta calls this with the verify token and expects the challenge
 * echoed back.
 */
webhooksRouter.get(
  '/:workspaceId',
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const workspace = UUID.test(workspaceId)
      ? await db.one('SELECT webhook_verify_token FROM workspaces WHERE id = $1', [workspaceId])
      : null;
    if (mode !== 'subscribe' || !workspace || typeof token !== 'string' || !safeEqual(token, workspace.webhookVerifyToken)) {
      return res.sendStatus(403);
    }
    return res.status(200).type('text/plain').send(String(challenge ?? ''));
  }),
);

/**
 * Incoming events. The signature is checked against the raw body, the payload
 * is queued, and Meta gets its 200 straight away; processing happens in the
 * worker so a slow database or media download can never cause Meta to retry.
 */
webhooksRouter.post(
  '/:workspaceId',
  express.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const account = UUID.test(workspaceId) ? await getAccount(workspaceId) : null;
    if (!account) return res.sendStatus(404);

    if (!verifyMetaSignature(req.rawBody, req.get('x-hub-signature-256'), account.appSecret)) {
      logger.warn({ workspaceId }, 'Rejected webhook with a bad signature');
      return res.sendStatus(401);
    }
    if (req.body?.object !== 'whatsapp_business_account') return res.sendStatus(200);

    await webhookQueue.add('whatsapp', { workspaceId, payload: req.body });
    return res.sendStatus(200);
  }),
);
