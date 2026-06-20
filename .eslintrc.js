module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'prettier'],
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
      // Tests legitimately manipulate env and use require() for module isolation.
      files: ['tests/**/*.ts', 'tests/**/*.tsx'],
      rules: {
        'no-restricted-properties': 'off',
        'no-restricted-syntax': 'off',
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
