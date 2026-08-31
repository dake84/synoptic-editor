// @ts-check
import js from "@eslint/js";
import tsdoc from "eslint-plugin-tsdoc";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["spikes/**/*.{ts,js}", "harness/**/*.{ts,js}", "examples/**/*.{ts,js}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // TSDoc blocks (`/** */`) on declarations must parse. The custom tag
    // `@covers` (SPEC rule ids on tests) is declared in tsdoc.json.
    files: ["**/*.{ts,tsx}"],
    plugins: {
      tsdoc,
    },
    rules: {
      "tsdoc/syntax": "error",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "examples/host/dist/**",
      "harness/dist/**",
      "spikes/**/dist/**",
    ],
  },
);
