export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': {
        rules: {
          'exhaustive-deps': {
            meta: { type: 'problem' },
            create: () => ({}),
          },
        },
      },
    },
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];
