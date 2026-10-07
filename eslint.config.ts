// Loaded by ESLint through jiti, which is why jiti is a dev dependency.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/', 'node_modules/', '*.vsix'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A forgotten await in a poller fails silently; make every floating promise explicit.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // node:test's describe/it return promises the runner tracks itself, and fakes are
    // async to match the interfaces they stand in for.
    files: ['src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Outside tsconfig's rootDir (src/), so lint it without type information.
    files: ['eslint.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
