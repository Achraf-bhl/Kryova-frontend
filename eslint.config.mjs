import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Rust build output: generated JS shipped into the Tauri bundle.
    "src-tauri/target/**",
    // Agent scratch. Git ignores it via its own .gitignore; flat config does
    // not skip dot-directories the way eslintrc did, so a hook writing a bare
    // timestamp to a file named .ts becomes a lint warning about our source.
    ".remember/**",
  ]),
]);

export default eslintConfig;
