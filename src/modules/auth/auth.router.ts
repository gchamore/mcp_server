import { Router } from 'express';
import { z } from 'zod';
import { recordAudit } from '../../core/audit.js';
import { notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { authLimiter, sensitiveLimiter } from '../../middleware/rate-limit.js';
import { getBody, getQuery, validate } from '../../middleware/validate.js';
import { isMailEnabled } from '../../services/mail.js';
import {
  authenticate,
  registerUser,
  toPublicUser,
  upsertGoogleUser,
} from './auth.service.js';
import { beginGoogleAuth, completeGoogleAuth, isGoogleEnabled } from './google.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleCallbackSchema,
  googleStartSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyTokenSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from './auth.schemas.js';
import {
  changePassword,
  requestPasswordReset,
  resetPassword,
  verifyResetToken,
} from './password.service.js';
import {
  clearSessionCookie,
  clientIp,
  createSession,
  readSessionToken,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
} from './session.service.js';

export const authRouter: Router = Router();

/** Indique au front quelles méthodes de connexion proposer. */
authRouter.get('/providers', (_req, res) => {
  res.json({ password: true, google: isGoogleEnabled(), passwordReset: isMailEnabled() });
});

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
  const input = getBody<RegisterInput>(req);
  const user = await registerUser(input);

  const token = await createSession(user.id, req);
  setSessionCookie(res, token);

  recordAudit({ action: 'user.register', userId: user.id, ipAddress: clientIp(req) });
  res.status(201).json({ user: toPublicUser(user) });
});

authRouter.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email, password } = getBody<LoginInput>(req);

  try {
    const user = await authenticate(email, password);
    const token = await createSession(user.id, req);
    setSessionCookie(res, token);

    recordAudit({ action: 'user.login', userId: user.id, ipAddress: clientIp(req) });
    res.json({ user: toPublicUser(user) });
  } catch (error) {
    recordAudit({ action: 'user.login_failed', metadata: { email }, ipAddress: clientIp(req) });
    throw error;
  }
});

authRouter.post('/logout', async (req, res) => {
  const token = readSessionToken(req);
  if (token) await revokeSession(token);
  clearSessionCookie(res);

  if (req.currentUser) recordAudit({ action: 'user.logout', userId: req.currentUser.userId });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: auth(req).userId } });
  if (!user) throw notFound('Utilisateur introuvable.');
  res.json({ user: toPublicUser(user) });
});

/** Déconnecte tous les appareils : utile après un doute sur la sécurité du compte. */
authRouter.post('/sessions/revoke-all', requireAuth, async (req, res) => {
  const count = await revokeAllSessions(auth(req).userId);
  clearSessionCookie(res);
  res.json({ revoked: count });
});

authRouter.delete('/account', requireAuth, sensitiveLimiter, async (req, res) => {
  const { userId } = auth(req);

  // Les connexions, endpoints et sessions partent en cascade (voir schema.prisma).
  await prisma.user.delete({ where: { id: userId } });
  clearSessionCookie(res);

  recordAudit({ action: 'user.delete', targetType: 'user', targetId: userId });
  res.status(204).end();
});

// --- Mots de passe ---------------------------------------------------------

authRouter.post(
  '/password/forgot',
  sensitiveLimiter,
  validate({ body: forgotPasswordSchema }),
  async (req, res) => {
    const { email } = getBody<{ email: string }>(req);
    await requestPasswordReset(email);
    recordAudit({ action: 'user.password_reset_requested', metadata: { email } });

    // Réponse volontairement identique que le compte existe ou non.
    res.json({
      message:
        'Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé.',
    });
  },
);

authRouter.get(
  '/password/verify',
  authLimiter,
  validate({ query: verifyTokenSchema }),
  async (req, res) => {
    const { token } = getQuery<{ token: string }>(req);
    res.json({ valid: await verifyResetToken(token) });
  },
);

authRouter.post(
  '/password/reset',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  async (req, res) => {
    const { token, password } = getBody<ResetPasswordInput>(req);
    await resetPassword(token, password);
    clearSessionCookie(res);

    recordAudit({ action: 'user.password_reset' });
    res.json({ message: 'Mot de passe mis à jour. Vous pouvez vous reconnecter.' });
  },
);

authRouter.post(
  '/password/change',
  requireAuth,
  sensitiveLimiter,
  validate({ body: changePasswordSchema }),
  async (req, res) => {
    const { userId } = auth(req);
    const { currentPassword, newPassword } = getBody<ChangePasswordInput>(req);

    await changePassword(userId, currentPassword, newPassword);
    recordAudit({ action: 'user.password_changed', userId });

    res.json({ message: 'Mot de passe mis à jour.' });
  },
);

// --- Google OAuth ----------------------------------------------------------

authRouter.get('/google', authLimiter, validate({ query: googleStartSchema }), (req, res) => {
  const { returnTo } = getQuery<{ returnTo?: string }>(req);
  res.redirect(beginGoogleAuth(res, returnTo));
});

authRouter.get(
  '/google/callback',
  authLimiter,
  validate({ query: googleCallbackSchema }),
  async (req, res) => {
    const query = getQuery<z.infer<typeof googleCallbackSchema>>(req);

    if (query.error || !query.code || !query.state) {
      res.redirect(`/connexion?erreur=${encodeURIComponent(query.error ?? 'oauth_annule')}`);
      return;
    }

    const { profile, returnTo } = await completeGoogleAuth(req, res, {
      code: query.code,
      state: query.state,
    });

    const user = await upsertGoogleUser(profile);
    const token = await createSession(user.id, req);
    setSessionCookie(res, token);

    recordAudit({ action: 'user.login', userId: user.id, metadata: { provider: 'google' } });

    // Redirection vers l'application : le jeton reste dans le cookie httpOnly,
    // il ne transite jamais par l'URL (contrairement à la version précédente).
    res.redirect(returnTo);
  },
);
