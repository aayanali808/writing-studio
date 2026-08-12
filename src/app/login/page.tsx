import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { auth, signIn } from '@/auth';

export const metadata = { title: 'Sign in — Writing Studio' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect('/studio');

  const { error } = await searchParams;

  async function authenticate(formData: FormData) {
    'use server';
    try {
      await signIn('credentials', {
        email: formData.get('email'),
        password: formData.get('password'),
        redirectTo: '/studio',
      });
    } catch (err) {
      // signIn throws a redirect on success — let that propagate.
      if (err instanceof AuthError) {
        redirect('/login?error=invalid');
      }
      throw err;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Writing Studio</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Sign in to continue.
        </p>

        <form action={authenticate} className="mt-8 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>

          {error ? (
            <p className="text-sm text-[var(--danger)]">
              Incorrect email or password.
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[#1a1409] transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
