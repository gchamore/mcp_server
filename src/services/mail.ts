import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../core/env.js';
import { logger } from '../core/logger.js';

/**
 * Envoi d'e-mails transactionnels (réinitialisation de mot de passe).
 *
 * Le service est facultatif : sans SMTP_HOST, il se désactive proprement et le
 * reste de l'application continue de fonctionner. En développement, le corps du
 * message est écrit dans les logs pour pouvoir suivre le lien sans SMTP.
 */

let transporter: Transporter | null = null;

export function initMailer(): void {
  if (!env.smtp.enabled) {
    logger.warn("SMTP non configuré : les e-mails seront écrits dans les logs (dev uniquement).");
    return;
  }

  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    ...(env.smtp.user && env.smtp.password
      ? { auth: { user: env.smtp.user, pass: env.smtp.password } }
      : {}),
  });

  logger.info({ host: env.smtp.host, port: env.smtp.port }, 'Service e-mail initialisé');
}

export const isMailEnabled = () => env.smtp.enabled;

export async function sendMail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  if (!transporter) {
    if (env.isProduction) {
      logger.error({ to: input.to }, 'E-mail non envoyé : SMTP non configuré');
      return;
    }
    logger.info({ to: input.to, subject: input.subject, body: input.text }, 'E-mail simulé (dev)');
    return;
  }

  try {
    await transporter.sendMail({
      from: env.smtp.enabled ? env.smtp.from : undefined,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    logger.info({ to: input.to, subject: input.subject }, 'E-mail envoyé');
  } catch (error) {
    // Un échec d'envoi ne doit jamais remonter à l'appelant : sinon la réponse
    // de « mot de passe oublié » révèle si l'adresse existe en base.
    logger.error({ err: error, to: input.to }, "Échec d'envoi d'e-mail");
  }
}

export function renderPasswordResetEmail(resetUrl: string, minutes: number) {
  const text = [
    'Réinitialisation de votre mot de passe MCP Wesype',
    '',
    `Ouvrez ce lien pour choisir un nouveau mot de passe (valable ${minutes} minutes) :`,
    resetUrl,
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <h1 style="font-size:20px;margin:0 0 16px">Réinitialisation de votre mot de passe</h1>
      <p style="line-height:1.6;color:#475569">
        Vous avez demandé à réinitialiser le mot de passe de votre compte MCP Wesype.
        Ce lien est valable ${minutes} minutes.
      </p>
      <p style="margin:28px 0">
        <a href="${resetUrl}"
           style="background:#1e3a8a;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">
          Choisir un nouveau mot de passe
        </a>
      </p>
      <p style="line-height:1.6;color:#64748b;font-size:13px">
        Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.
      </p>
    </div>`;

  return { text, html };
}
