export default [
  {
    // ESLint does not read .gitignore: generated app/js is deliberately included.
    files: ['app/**/*.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script'
    }
  },
  {
    files: ['app/js/**/*.js'],
    rules: {
      // The webview uses plain <script> tags; only app/scripts may use CommonJS.
      'no-restricted-globals': ['error', 'require', 'module', 'exports']
    }
  }
];
