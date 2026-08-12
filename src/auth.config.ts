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
    /**
     * An optimistic page-level gate, not the authorization boundary — the Next
     * docs are explicit that proxy shouldn't be used for session management.
     * Every route handler and server page calls `auth()` / `requireSession()`
     * for itself.
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      // The login page and the Auth.js endpoints must stay reachable.
      if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
        return true;
      }

      // Let API requests through to their handlers, which answer with a JSON
      // 401. Redirecting them here would hand the panes an HTML login page
      // where they expect JSON, turning an expired session into a parse error.
      if (pathname.startsWith('/api/')) {
        return true;
      }

      return Boolean(auth?.user);
    },
  },
  providers: [],
} satisfies NextAuthConfig;
