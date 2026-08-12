import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { authConfig } from './auth.config';

/**
 * Single hardcoded user, defined entirely by env vars:
 *   AUTH_USER_EMAIL          the one allowed email
 *   AUTH_USER_PASSWORD_HASH  a bcrypt hash (generate with `npm run hash-password`)
 *   AUTH_SECRET              JWT signing secret
 *
 * There is no user table and no signup route — this is a personal app.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === 'string' ? credentials.email : '';
        const password =
          typeof credentials?.password === 'string' ? credentials.password : '';

        const allowedEmail = process.env.AUTH_USER_EMAIL;
        const passwordHash = process.env.AUTH_USER_PASSWORD_HASH;

        if (!allowedEmail || !passwordHash) {
          throw new Error(
            'AUTH_USER_EMAIL / AUTH_USER_PASSWORD_HASH are not configured.'
          );
        }
        if (!email || !password) return null;

        // Always run the bcrypt compare, even on an email mismatch, so a wrong
        // email and a wrong password take the same amount of time.
        const passwordOk = await bcrypt.compare(password, passwordHash);
        const emailOk =
          email.trim().toLowerCase() === allowedEmail.trim().toLowerCase();

        if (!passwordOk || !emailOk) return null;

        return { id: 'owner', email: allowedEmail, name: 'Owner' };
      },
    }),
  ],
});

/**
 * Guard for route handlers. Returns `null` when the caller is authenticated,
 * or the 401 Response the handler should return immediately.
 *
 *   const unauthorized = await requireSession();
 *   if (unauthorized) return unauthorized;
 */
export async function requireSession(): Promise<Response | null> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
