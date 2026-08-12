import next from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 exports flat config arrays directly, so the FlatCompat
 * shim is not needed (and in fact throws on this config).
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...next,
  ...nextTypescript,
  {
    rules: {
      // Underscore-prefixed args are deliberate: dockview panel components and
      // route handlers receive parameters they don't always use.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
