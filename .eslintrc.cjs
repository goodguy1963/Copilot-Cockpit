/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    warnOnUnsupportedTypeScriptVersion: false,
  },
  // Keep this minimal: the primary purpose is to make `npm run lint` executable.
  // Add/enable rules deliberately to avoid introducing large, unrelated refactors.
  rules: {},
};
