import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe slice of the Auth.js config.
 *
 * This deliberately contains no providers and no bcrypt/pg imports so it can be
 * loaded by `proxy.ts`, which may run outside the Node runtime. The full config
 * (with the Credentials provider) lives in `src/auth.ts`.
 */
export const authConfig = {
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 30, // 30 days — it's a personal tool, stay logged in.
  },
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;

      // The login page and the Auth.js endpoints must stay reachable.
      if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
        return true;
      }
      return isLoggedIn;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
