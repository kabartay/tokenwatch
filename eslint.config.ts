// Loaded by ESLint through jiti, which is why jiti is a dev dependency.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** An import that a layer must not use, matched against the import specifier. */
interface Forbidden {
  regex: string;
  message: string;
}

const layerImport = (name: string): Forbidden => ({
  regex: `(^|/)${name}/`,
  message: 'Dependencies point inward: domain ← application ← infrastructure/ui. See docs/ARCHITECTURE.md.',
});
const VSCODE: Forbidden = { regex: '^vscode$', message: 'Only ui/ and extension.ts may import vscode.' };
const NODE_IO: Forbidden = {
  regex: '^(node:)?(fs|fs/promises|http|https|net|child_process|os|path|readline)$',
  message: 'I/O belongs in infrastructure/; keep this layer pure so it is testable without fakes.',
};

/** Fails the lint when a layer imports something its position in the architecture forbids. */
const boundaries = (files: string, forbidden: Forbidden[]) => ({
  files: [files],
  rules: { 'no-restricted-imports': ['error', { patterns: forbidden }] },
});

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
  boundaries('src/domain/**/*.ts', [
    layerImport('application'),
    layerImport('infrastructure'),
    layerImport('ui'),
    VSCODE,
    NODE_IO,
  ]),
  boundaries('src/application/**/*.ts', [layerImport('infrastructure'), layerImport('ui'), VSCODE, NODE_IO]),
  boundaries('src/infrastructure/**/*.ts', [layerImport('ui'), VSCODE]),
  boundaries('src/ui/**/*.ts', [layerImport('infrastructure')]),
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
