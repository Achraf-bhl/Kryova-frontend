/**
 * Fail if this repo has grown a runtime dependency.
 *
 * CLAUDE.md: "Dependencies are deliberately three packages: next, react,
 * react-dom. No UI kit, no three.js, no fetch library, no state manager. The
 * 3D viewer is hand-written WebGL 1. ... that minimalism is the current design,
 * not an oversight." A new dependency is a named decision, not an import.
 *
 * A rule like that survives exactly as long as somebody remembers it during
 * review. `npm install some-nice-thing` writes it into package.json in one
 * second and nothing else in the repo notices -- lint, tsc, vitest and the
 * build are all perfectly happy with a fourth dependency. So the decision gets
 * a check.
 *
 * This is a *speed bump*, not a prohibition. Adding a dependency on purpose
 * means adding it to ALLOWED below in the same commit, which is what makes it
 * a named decision: the diff shows the package and the reviewer sees it.
 *
 * devDependencies are deliberately not policed -- the constraint is about what
 * ships to the browser, and the toolchain (eslint, vitest, tailwind, tauri) is
 * a different question.
 *
 * Run it anywhere:  node scripts/check-dependencies.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The three, and the reason each one is not negotiable away. */
const ALLOWED = new Set(["next", "react", "react-dom"]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const actual = Object.keys(pkg.dependencies ?? {}).sort();

const added = actual.filter((name) => !ALLOWED.has(name));
const removed = [...ALLOWED].filter((name) => !actual.includes(name)).sort();

if (added.length === 0 && removed.length === 0) {
  console.log(`Runtime dependencies unchanged: ${actual.join(", ")}`);
  process.exit(0);
}

if (added.length > 0) {
  console.error(
    `Unexpected runtime dependencies: ${added.join(", ")}\n\n` +
      "This repo keeps three, on purpose (see CLAUDE.md). Before adding a\n" +
      "fourth, check whether the hand-rolled equivalent should be extended\n" +
      "instead -- the WebGL viewer, lib/markdown.ts and lib/api-client.ts all\n" +
      "exist because that answer was yes.\n\n" +
      "If the dependency is genuinely the right call, add it to ALLOWED in\n" +
      "scripts/check-dependencies.mjs in the same commit. That is the whole\n" +
      "point: the decision becomes visible in the diff rather than silent.",
  );
}

if (removed.length > 0) {
  console.error(
    `\nExpected runtime dependencies are missing: ${removed.join(", ")}\n` +
      "If one was deliberately dropped, remove it from ALLOWED here too, or\n" +
      "this check goes on asserting a shape the repo no longer has.",
  );
}

process.exit(1);
