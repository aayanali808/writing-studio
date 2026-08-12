import type { Config } from 'tailwindcss';

/**
 * Colours live in CSS custom properties (see globals.css) and are referenced in
 * components as `text-[var(--text-muted)]`, so there is deliberately no colour
 * palette here — one source of truth, and the dockview theme reads the same vars.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'var(--font-geist-sans)',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
        serif: ['Iowan Old Style', 'Palatino', 'Georgia', 'ui-serif', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
