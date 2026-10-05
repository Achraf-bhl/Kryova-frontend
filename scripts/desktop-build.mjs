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
 * **`--bundled` builds the installer that needs no checkout** (ROAD_TO_10 4.1-4.3): it first
 * stages everything the app runs into `src-tauri/bundle/` (`stage-desktop.mjs`), merges the
 * release overlay (`desktop-config.mjs`) over `tauri.conf.json`, and bakes **no** checkout path
 * into the binary -- those name the build machine, and an installer has no business knowing
 * where it was built. Without the flag this is the build it always was.
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

import { overlayArgument, releaseOverlay } from "./desktop-config.mjs";

const argv = process.argv.slice(2);
const bundled = argv.includes("--bundled");
const tauriArgs = argv.filter((arg) => arg !== "--bundled" && arg !== "--no-stage");

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
  // Inlined into the client bundle by `npm run build` (tauri's beforeBuildCommand
  // inherits this environment). Without it the bundle falls back to a `localhost`
  // default, and the window — served from 127.0.0.1 — would then call a different
  // host than the one it was loaded from: an IPv6 miss at best, and at worst a
  // cross-site request that drops the session cookie.
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api/v1",
};

if (bundled) {
  // `option_env!` in lib.rs bakes whatever is in the environment at compile time. An installer
  // that carries "D:\a\Kryova-frontend" or a runner-local node is carrying the build machine.
  for (const key of ["KRYOVA_FRONTEND_DIR", "KRYOVA_NODE"]) delete env[key];
  delete env.KRYOVA_BACKEND_DIR;
}

for (const key of [
  "KRYOVA_FRONTEND_DIR",
  "KRYOVA_BACKEND_DIR",
  "KRYOVA_NODE",
  "NEXT_PUBLIC_API_URL",
]) {
  console.log(`  ${key} = ${env[key] ?? "(not baked in)"}`);
}

if (bundled && !argv.includes("--no-stage")) {
  const staged = spawnSync(
    process.execPath,
    [join(frontendDir, "scripts", "stage-desktop.mjs")],
    { cwd: frontendDir, env: { ...process.env, KRYOVA_BACKEND_DIR: backendDir }, stdio: "inherit" },
  );
  if (staged.status !== 0) {
    console.error("Staging the bundle failed; not building an installer around a partial tree.");
    process.exit(staged.status ?? 1);
  }
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
  [tauriCli, "build", ...overlayArgument(releaseOverlay({ bundled })), ...tauriArgs],
  { cwd: frontendDir, env, stdio: "inherit" },
);

process.exit(result.status ?? 1);
