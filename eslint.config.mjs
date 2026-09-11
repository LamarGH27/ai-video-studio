import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // The service-role client bypasses RLS entirely. `server-only` already
      // breaks the build on a client import; this makes the mistake visible in
      // the editor rather than at build time.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase/admin',
              message:
                'The service-role client is server-only. Import it from server code (server actions, route handlers, server components) only — never from a "use client" module.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['tests/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  prettierConfig,
];

export default eslintConfig;
