import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      'no-new': 'error',
    },
  },
  {
    ignores: ['dist/**', 'demo/**', 'scripts/**', 'node_modules/**', '*.config.js'],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
);
