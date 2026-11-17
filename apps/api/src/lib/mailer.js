import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';

const transporter = config.smtp
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Send a transactional email with one call-to-action link. Without SMTP
 * settings the link is written to the log so local development still works.
 * Never throws: a mail failure must not break signup or invite flows.
 */
export async function sendActionEmail({ to, subject, intro, actionLabel, actionUrl }) {
  if (!transporter) {
    logger.warn({ to, subject, actionUrl }, 'SMTP is not configured; email not sent (link logged instead)');
    return false;
  }
  try {
    await transporter.sendMail({
      from: config.mailFrom,
      to,
      subject,
      text: `${intro}\n\n${actionLabel}: ${actionUrl}\n\nIf you did not expect this email you can ignore it.`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#0f172a;max-width:480px">
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(actionLabel)}</a></p>
<p style="color:#64748b;font-size:13px">If you did not expect this email you can ignore it.</p>
</div>`,
    });
    return true;
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'Failed to send email');
    return false;
  }
}

export const mailEnabled = Boolean(transporter);
