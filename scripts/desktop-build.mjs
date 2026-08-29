/**
 * Build the desktop app with the repo paths baked into the binary.
 *
 * `src-tauri/src/lib.rs` finds the two checkouts through `option_env!`, which
 * is resolved when the Rust crate is *compiled*. A plain `tauri build` bakes
 * nothing, and the installed app then starts no backend, no frontend and no
 * CATIA bridge: it waits out its 90-second timeout and shows a window that
 * failed to load. Nothing about that failure points at a missing environment
 * variable, which is why this is a script and not a line in the README.
 *
 * The paths are derived rather than configured. The frontend is this repo; the
 * backend is its sibling, which is the layout the app already assumes; node is
 * whichever one is running this. An explicit environment variable still wins,
 * so a different layout needs no change here.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir =
  process.env.KRYOVA_BACKEND_DIR ?? resolve(frontendDir, "..", "Kryova-backend");

if (!existsSync(join(backendDir, "app", "main.py"))) {
  console.error(
    `No Kryova backend at ${backendDir}.\n` +
      "The desktop app launches the backend itself, so the path is compiled in.\n" +
      "Set KRYOVA_BACKEND_DIR to the checkout and run this again.",
  );
  process.exit(1);
}

const env = {
  ...process.env,
  KRYOVA_FRONTEND_DIR: process.env.KRYOVA_FRONTEND_DIR ?? frontendDir,
  KRYOVA_BACKEND_DIR: backendDir,
  KRYOVA_NODE: process.env.KRYOVA_NODE ?? process.execPath,
};

for (const key of ["KRYOVA_FRONTEND_DIR", "KRYOVA_BACKEND_DIR", "KRYOVA_NODE"]) {
  console.log(`  ${key} = ${env[key]}`);
}

// The CLI's own JS entry point, run with this node. Not `npx tauri`: since
// Node 20 closed CVE-2024-27980, `spawnSync` will not launch a `.cmd` shim
// without a shell, and it fails with status 1 and no output at all -- which
// looks exactly like a build error and is not one.
const tauriCli = join(frontendDir, "node_modules", "@tauri-apps", "cli", "tauri.js");
if (!existsSync(tauriCli)) {
  console.error(`No Tauri CLI at ${tauriCli}. Run 'npm install' first.`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [tauriCli, "build", ...process.argv.slice(2)],
  { cwd: frontendDir, env, stdio: "inherit" },
);

process.exit(result.status ?? 1);
