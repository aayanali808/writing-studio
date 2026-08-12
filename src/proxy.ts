import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`. This gates every route behind
 * the session, using the edge-safe config only (no bcrypt, no pg).
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Skip Next internals and static assets; the login page and /api/auth are
  // allowed through by the `authorized` callback in auth.config.ts.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|woff2?)$).*)'],
};
