import tseslint from 'typescript-eslint';

// Correctness rules only. TypeScript owns type diagnostics; the model reviews design.
export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  {
    files: ['src/**/*.ts', 'api/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'constructor-super': 'error',
      'no-async-promise-executor': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      '@typescript-eslint/await-thenable': 'off'
    }
  },
  {
    files: ['ops/quality/**/*.mjs'],
    rules: { 'no-async-promise-executor': 'error', 'no-debugger': 'error', 'no-duplicate-case': 'error', 'no-unreachable': 'error', 'no-unsafe-finally': 'error', 'use-isnan': 'error' }
  }
];
