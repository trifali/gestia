import { HttpError } from 'wasp/server';
import { createProviderId, sanitizeAndSerializeProviderData, createUser } from 'wasp/server/auth';
import { hashPassword } from 'wasp/auth/password';
import { requireAdmin } from '../../server/tenant';
import type { AdminCreateUser, AdminUpdateUser, AdminDeleteUser, GetAdminUsers } from 'wasp/server/operations';
import type { User } from 'wasp/entities';

type Args = {
  email: string;
  password: string;
  fullName?: string;
};

export const adminCreateUser: AdminCreateUser<Args, { ok: boolean; userId: string }> = async (
  args,
  context,
) => {
  requireAdmin(context.user);

  const email = args.email.trim().toLowerCase();
  if (!email || !args.password) {
    throw new HttpError(400, 'Courriel et mot de passe requis.');
  }
  if (args.password.length < 8) {
    throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  }

  const providerId = createProviderId('email', email);
  const hashedPassword = await hashPassword(args.password);
  const serializedProviderData = await sanitizeAndSerializeProviderData<'email'>({
    hashedPassword,
    isEmailVerified: true,
    emailVerificationSentAt: null,
    passwordResetSentAt: null,
  });

  const adminEmails = process.env.ADMIN_EMAILS?.split(',').map((e) => e.trim()) || [];
  const role = adminEmails.includes(email) ? 'admin' : 'client';
  const isAdmin = role === 'admin';

  try {
    const result = await createUser(providerId, serializedProviderData, {
      email,
      username: email,
      isAdmin,
      role,
      fullName: args.fullName?.trim() || null,
    });
    return { ok: true, userId: result.id };
  } catch (err: any) {
    if (err?.code === 'P2002' || err?.message?.includes('Unique constraint')) {
      throw new HttpError(409, 'Un compte avec ce courriel existe déjà.');
    }
    throw new HttpError(500, 'Impossible de créer le compte. Réessayez.');
  }
};

// ── List all users ────────────────────────────────────────────────────────────

type UserRow = Pick<User, 'id' | 'email' | 'fullName' | 'role' | 'isAdmin' | 'createdAt'> & {
  companyName: string | null;
};

export const getAdminUsers: GetAdminUsers<void, UserRow[]> = async (_args, context) => {
  requireAdmin(context.user);
  const users = await context.entities.User.findMany({
    orderBy: { createdAt: 'desc' },
    include: { company: { select: { name: true } } },
  });
  return users.map((u: any) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    companyName: u.company?.name ?? null,
  }));
};

// ── Update a user ─────────────────────────────────────────────────────────────

type UpdateArgs = { userId: string; fullName?: string; email?: string };

export const adminUpdateUser: AdminUpdateUser<UpdateArgs, { ok: boolean }> = async (args, context) => {
  requireAdmin(context.user);
  if (!args.userId) throw new HttpError(400, 'userId requis.');

  const data: Record<string, any> = {};
  if (args.fullName !== undefined) data.fullName = args.fullName.trim() || null;
  if (args.email !== undefined) {
    const email = args.email.trim().toLowerCase();
    if (!email) throw new HttpError(400, 'Courriel invalide.');
    data.email = email;
    data.username = email;
  }

  try {
    await context.entities.User.update({ where: { id: args.userId }, data });
    return { ok: true };
  } catch (err: any) {
    if (err?.code === 'P2002' || err?.message?.includes('Unique constraint')) {
      throw new HttpError(409, 'Ce courriel est déjà utilisé.');
    }
    throw new HttpError(500, 'Impossible de mettre à jour le compte.');
  }
};

// ── Delete a user ─────────────────────────────────────────────────────────────

export const adminDeleteUser: AdminDeleteUser<{ userId: string }, { ok: boolean }> = async (args, context) => {
  requireAdmin(context.user);
  if (!args.userId) throw new HttpError(400, 'userId requis.');
  if (args.userId === context.user!.id) {
    throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte.');
  }
  await context.entities.User.delete({ where: { id: args.userId } });
  return { ok: true };
};
