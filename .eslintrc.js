module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: [
    '@typescript-eslint',
    'prettier',
    'react-native',
    'react-hooks',
    'import',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  env: {
    'react-native/react-native': true,
    es2022: true,
    node: true,
    jest: true,
  },
  ignorePatterns: [
    'node_modules/',
    '.expo/',
    'dist/',
    'coverage/',
    'babel.config.js',
    'metro.config.js',
    'tailwind.config.js',
    'jest.config.js',
    // Deno edge functions — linted/typechecked by Deno, not the client ESLint.
    'supabase/functions/',
  ],
  rules: {
    'prettier/prettier': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    // React hooks correctness. `exhaustive-deps` is a warning the code
    // suppresses inline at deliberate sites.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // Imports must precede other statements — test files that mock before
    // importing suppress this inline.
    'import/first': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // ── Flowlog architectural guardrails ──────────────────────────────
    // RULE: process.env may ONLY be read inside src/config/env.ts.
    // Everywhere else, import the typed `env` object from '@/config/env'.
    'no-restricted-properties': [
      'error',
      {
        object: 'process',
        property: 'env',
        message:
          'Do not read process.env directly. Import the typed `env` object from "@/config/env".',
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "MemberExpression[object.name='process'][property.name='env']",
        message:
          'Do not read process.env directly. Import the typed `env` object from "@/config/env".',
      },
    ],
  },
  overrides: [
    {
      // The single file allowed to touch process.env.
      files: ['src/config/env.ts'],
      rules: {
        'no-restricted-properties': 'off',
        'no-restricted-syntax': 'off',
      },
    },
    {
      // Standalone Node CLI scripts. These are not part of the app bundle:
      // they run on `node` directly, outside Expo, so the typed `env` object
      // (which validates EXPO_PUBLIC_* vars) does not apply and cannot supply
      // a server-side key such as ANTHROPIC_API_KEY. Reading process.env is
      // the correct thing to do here.
      files: ['scripts/**/*.ts'],
      rules: {
        'no-restricted-properties': 'off',
        'no-restricted-syntax': 'off',
      },
    },
    {
      // Tests legitimately manipulate env and use require() for module isolation.
      files: ['tests/**/*.ts', 'tests/**/*.tsx'],
      rules: {
        'no-restricted-properties': 'off',
        'no-restricted-syntax': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        // Tests mock modules with jest.mock() before importing the unit under
        // test, so imports legitimately follow statements.
        'import/first': 'off',
      },
    },
  ],
};
