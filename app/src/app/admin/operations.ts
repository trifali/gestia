import { HttpError } from 'wasp/server';
import { prisma } from 'wasp/server';
import { createProviderId, sanitizeAndSerializeProviderData, createUser } from 'wasp/server/auth';

// App-level admin only — company owners (role='admin') must NOT access user management
function requireAppAdmin(user: any) {
  if (!user?.isAdmin) throw new HttpError(403, 'Accès réservé aux administrateurs.');
}
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
  requireAppAdmin(context.user);

  const email = args.email.trim().toLowerCase();
  if (!email || !args.password) {
    throw new HttpError(400, 'Courriel et mot de passe requis.');
  }
  if (args.password.length < 8) {
    throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  }

  const providerId = createProviderId('email', email);
  const serializedProviderData = await sanitizeAndSerializeProviderData<'email'>({
    hashedPassword: args.password,
    isEmailVerified: true,
    emailVerificationSentAt: null,
    passwordResetSentAt: null,
  });

  // Admin status is always determined by ADMIN_EMAILS env var at login time,
  // never by the UI. Accounts created here are always 'client' accounts.
  try {
    const result = await createUser(providerId, serializedProviderData, {
      email,
      username: email,
      isAdmin: false,
      role: 'client',
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
  status: string;
  companyName: string | null;
};

export const getAdminUsers: GetAdminUsers<void, UserRow[]> = async (_args, context) => {
  requireAppAdmin(context.user);
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
    status: u.status,
    createdAt: u.createdAt,
    companyName: u.company?.name ?? null,
  }));
};

// ── Update a user ─────────────────────────────────────────────────────────────

type UpdateArgs = { userId: string; fullName?: string; status?: string; password?: string };

export const adminUpdateUser: AdminUpdateUser<UpdateArgs, { ok: boolean }> = async (args, context) => {
  requireAppAdmin(context.user);
  if (!args.userId) throw new HttpError(400, 'userId requis.');

  const data: Record<string, any> = {};
  if (args.fullName !== undefined) data.fullName = args.fullName.trim() || null;
  if (args.status !== undefined) {
    if (!['active', 'cancelled'].includes(args.status)) throw new HttpError(400, 'Statut invalide.');
    data.status = args.status;
  }

  // Password change — update the AuthIdentity providerData
  const newPassword = args.password?.trim();
  if (newPassword) {
    if (newPassword.length < 8) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  }

  try {
    await context.entities.User.update({ where: { id: args.userId }, data });

    // Update password if provided
    if (newPassword) {
      const serialized = await sanitizeAndSerializeProviderData<'email'>({
        hashedPassword: newPassword,
        isEmailVerified: true,
        emailVerificationSentAt: null,
        passwordResetSentAt: null,
      });
      const authRecord = await prisma.auth.findUnique({ where: { userId: args.userId }, select: { id: true } });
      if (authRecord) {
        await prisma.authIdentity.updateMany({
          where: { authId: authRecord.id, providerName: 'email' },
          data: { providerData: serialized },
        });
      }
    }

    // Invalidate all sessions when suspending or when password changes
    if (args.status === 'cancelled' || newPassword) {
      const auth = await prisma.auth.findUnique({ where: { userId: args.userId }, select: { id: true } });
      if (auth) {
        await prisma.session.deleteMany({ where: { userId: auth.id } });
      }
    }

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
  requireAppAdmin(context.user);
  if (!args.userId) throw new HttpError(400, 'userId requis.');
  if (args.userId === context.user!.id) {
    throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte.');
  }
  await context.entities.User.delete({ where: { id: args.userId } });
  return { ok: true };
};
