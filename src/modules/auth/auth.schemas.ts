import { z } from 'zod';

/**
 * Schémas d'entrée de l'authentification. La politique de mot de passe est
 * définie une seule fois ici et réutilisée par l'inscription, la
 * réinitialisation et le changement — impossible qu'elles divergent.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Adresse e-mail requise')
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Adresse e-mail invalide');

export const passwordSchema = z
  .string()
  .min(10, 'Le mot de passe doit contenir au moins 10 caractères')
  .max(200, 'Le mot de passe est trop long')
  .refine((value) => value.trim().length >= 10, 'Le mot de passe ne peut pas être composé d’espaces');

const nameSchema = z.string().trim().min(1).max(80).optional();

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Volontairement laxiste : la politique s'applique à la création, pas à la
  // vérification, sinon les comptes anciens deviendraient inaccessibles.
  password: z.string().min(1, 'Mot de passe requis').max(200),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const verifyTokenSchema = z.object({ token: z.string().min(10) });

export const googleCallbackSchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

export const googleStartSchema = z.object({ returnTo: z.string().max(512).optional() });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
