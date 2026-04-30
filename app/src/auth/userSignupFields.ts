import { z } from 'zod';
import { defineUserSignupFields } from 'wasp/auth/providers/types';

const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];

const emailDataSchema = z.object({
  email: z.string(),
});

export const getEmailUserFields = defineUserSignupFields({
  email: (data) => emailDataSchema.parse(data).email,
  username: (data) => emailDataSchema.parse(data).email,
  isAdmin: (data) => adminEmails.includes(emailDataSchema.parse(data).email),
});
