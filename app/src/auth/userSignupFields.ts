import { z } from 'zod';
import { defineUserSignupFields } from 'wasp/auth/providers/types';

const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];

function assertSignupEnabled() {
  if (process.env.DISABLE_SIGNUP === 'true') {
    throw new Error('Les nouvelles inscriptions sont temporairement fermées.');
  }
}

const emailDataSchema = z.object({
  email: z.string(),
});

export const getEmailUserFields = defineUserSignupFields({
  email: (data) => {
    assertSignupEnabled();
    return emailDataSchema.parse(data).email;
  },
  username: (data) => emailDataSchema.parse(data).email,
  isAdmin: (data) => adminEmails.includes(emailDataSchema.parse(data).email),
});
