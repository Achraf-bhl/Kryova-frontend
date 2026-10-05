/**
 * Assemble everything an installed Kryova runs into `src-tauri/bundle/` (ROAD_TO_10 4.1-4.3).
 *
 * The shell used to start two servers from checkouts whose paths were compiled into the
 * binary, so an installer built anywhere started nothing anywhere else. An installed app now
 * carries what it runs beside its executable, and this script builds that tree:
 *
 *   bundle/frontend/            the Next standalone server (server.js, .next/static, public)
 *   bundle/runtime/node/        a pinned Node runtime
 *   bundle/backend/python/      a pinned, relocatable CPython with the backend's wheels
 *   bundle/backend/app/ ...     the backend's own code (an allow-list, never a directory copy)
 *   bundle/postgres/            PostgreSQL's bin, lib and share, and nothing else
 *
 * The names are `src-tauri/src/layout.rs`'s. `REQUIRED_FILES` below and that file's list are
 * read against each other by `src/lib/desktop-bundle.test.ts`, so a rename in one place cannot
 * leave the shell looking for a file this script no longer writes.
 *
 * **Every download is pinned and refused on a hash mismatch** (`desktop-runtime.json`).
 * An installer that carries an interpreter somebody swapped on a mirror is a supply-chain
 * hole with a signature on it.
 *
 * **Not PyInstaller** for the backend, on purpose: its import scanning has a long record of
 * missing OCP's and gmsh's native plugins. The interpreter is a stock relocatable CPython and
 * the wheels are installed into it, so what ships is what `pip` put there.
 *
 * Run it on the machine the installer is for. On a Windows runner every step is native. On
 * any other machine it still produces a Windows tree -- the wheels are cross-installed with
 * `uv` -- which is how it is exercised without a Windows machine, and which proves the tree
 * is complete and not that it runs.
 *
 *   node scripts/stage-desktop.mjs [--out <dir>] [--cache <dir>] [--skip-build]
 *        [--skip-frontend] [--skip-node] [--skip-python] [--skip-postgres] [--skip-backend]
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FRONTEND_DIR = resolve(here, "..");

/**
 * What the installed app must contain, relative to the bundle root, for a Windows target.
 * `src-tauri/src/layout.rs` holds the same list (its `required()`), and a test compares them.
 */
export const REQUIRED_FILES = [
  "frontend/server.js",
  "runtime/node/node.exe",
  "backend/python/python.exe",
  "backend/app/desktop.py",
  "postgres/bin/pg_ctl.exe",
];

/**
 * What the bundle must never contain. Two lists because the interpreter's own tree is full of
 * directories that share these names (`Lib/venv` is the standard library; every wheel ships a
 * `tests`), so a name is only forbidden everywhere when nothing legitimate can be called that.
 */
export const FORBIDDEN_BASENAMES = [".env", ".env.local", ".env.production", ".git", "src-tauri", ".venv"];
export const FORBIDDEN_PATHS = [
  // The signature of Next tracing the whole project instead of what the server reads: found by
  // the first real staging run, when one dynamic `path.join` in a route put the source, the
  // scripts and `src-tauri/target` (5 GB) into the installer. A standalone server holds
  // `.next`, `node_modules`, `public` and `server.js`; none of these belong to it.
  "frontend/src",
  "frontend/scripts",
  "frontend/CLAUDE.md",
  "frontend/AGENTS.md",
  "backend/tests",
  "backend/venv",
  "backend/media_data",
  // 450 MB of reference manuals the installer has no business carrying; the agent consults
  // them only when an index exists, and a missing index answers empty, never an error.
  "backend/data/bm25",
];

export function readManifest(path = join(here, "desktop-runtime.json")) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  for (const name of ["node", "python", "postgres"]) {
    const entry = manifest[name];
    if (!entry || !entry.url?.startsWith("https://") || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
      throw new Error(`desktop-runtime.json: "${name}" needs an https url and a 64-digit sha256`);
    }
  }
  return manifest;
}

/** The bundle's missing files, as sentences. Empty means complete. */
export function layoutProblems(root, required = REQUIRED_FILES) {
  return required
    .filter((file) => !existsSync(join(root, file)) || !statSync(join(root, file)).isFile())
    .map((file) => `missing ${file}`);
}

/** Every path under `root` the bundle must never carry. */
export function forbiddenPaths(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split("\\").join("/");
      if (FORBIDDEN_BASENAMES.includes(entry.name) || FORBIDDEN_PATHS.includes(rel)) {
        found.push(rel);
        continue; // no need to look inside what is already refused
      }
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return found;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/** Download `url` into the cache (or reuse it) and return the path -- only if its hash matches. */
export async function fetchPinned({ url, sha256 }, cacheDir, log = console.log) {
  mkdirSync(cacheDir, { recursive: true });
  const target = join(cacheDir, basename(new URL(url).pathname));
  if (existsSync(target) && (await sha256File(target)) === sha256) {
    log(`  cached  ${basename(target)}`);
    return target;
  }
  log(`  fetch   ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`${url} answered ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(target));
  const actual = await sha256File(target);
  if (actual !== sha256) {
    rmSync(target, { force: true });
    throw new Error(
      `${basename(target)} hashes to ${actual}, not the pinned ${sha256}. ` +
        "Refusing to stage a runtime that is not the one desktop-runtime.json names.",
    );
  }
  return target;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
}

/** Extract a .zip or .tar.gz into `dest`. bsdtar (Windows 10+) reads both; elsewhere zip needs unzip. */
export function extract(archive, dest) {
  mkdirSync(dest, { recursive: true });
  if (archive.endsWith(".tar.gz")) {
    run("tar", ["-xzf", archive, "-C", dest]);
  } else if (process.platform === "win32") {
    run("tar", ["-xf", archive, "-C", dest]);
  } else {
    run("unzip", ["-q", "-o", archive, "-d", dest]);
  }
}

function fresh(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function stageFrontend(out, { skipBuild }) {
  console.log("frontend: Next standalone server");
  if (!skipBuild) {
    const next = join(FRONTEND_DIR, "node_modules", "next", "dist", "bin", "next");
    run(process.execPath, [next, "build"], {
      cwd: FRONTEND_DIR,
      env: {
        ...process.env,
        KRYOVA_STANDALONE: "1",
        // Inlined into the client bundle and the middleware at build time. The numeric
        // address, for the reason `desktop-build.mjs` gives: the window is served from
        // 127.0.0.1 and `localhost` would resolve to ::1.
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api/v1",
      },
    });
  }
  const standalone = join(FRONTEND_DIR, ".next", "standalone");
  if (!existsSync(join(standalone, "server.js"))) {
    throw new Error(
      `${standalone}/server.js does not exist. The build was not made with KRYOVA_STANDALONE=1 ` +
        "(drop --skip-build), or Next traced from a different root.",
    );
  }
  const dest = join(out, "frontend");
  fresh(dest);
  cpSync(standalone, dest, { recursive: true });
  // `server.js` serves neither of these itself: a standalone build leaves static assets and
  // `public/` to whatever fronts it, and here nothing does.
  cpSync(join(FRONTEND_DIR, ".next", "static"), join(dest, ".next", "static"), { recursive: true });
  if (existsSync(join(FRONTEND_DIR, "public"))) {
    cpSync(join(FRONTEND_DIR, "public"), join(dest, "public"), { recursive: true });
  }
}

async function stageNode(out, manifest, cache) {
  console.log("node runtime");
  const archive = await fetchPinned(manifest.node, cache);
  const scratch = join(cache, "node-extract");
  fresh(scratch);
  extract(archive, scratch);
  const dest = join(out, "runtime", "node");
  fresh(dest);
  // The executable alone. npm, corepack and the headers are 80 MB the app never runs.
  cpSync(join(scratch, manifest.node.inside_archive), join(dest, "node.exe"));
}

async function stagePostgres(out, manifest, cache) {
  console.log("postgres: bin, lib, share");
  const archive = await fetchPinned(manifest.postgres, cache);
  const scratch = join(cache, "postgres-extract");
  fresh(scratch);
  extract(archive, scratch);
  const dest = join(out, "postgres");
  fresh(dest);
  // pgAdmin, the docs, the headers and StackBuilder are 750 MB of the 914 MB zip, and
  // nothing in the product runs them.
  for (const part of manifest.postgres.keep) {
    cpSync(join(scratch, manifest.postgres.inside_archive, part), join(dest, part), { recursive: true });
  }
}

async function stagePython(out, manifest, cache) {
  console.log("python: relocatable CPython");
  const archive = await fetchPinned(manifest.python, cache);
  const scratch = join(cache, "python-extract");
  fresh(scratch);
  extract(archive, scratch);
  const dest = join(out, "backend", "python");
  fresh(dest);
  cpSync(join(scratch, manifest.python.inside_archive), dest, { recursive: true });
}

function stageBackend(out, backendDir) {
  console.log("backend: code, wheels, precompiled bytecode");
  const script = join(backendDir, "scripts", "stage_desktop_backend.py");
  if (!existsSync(script)) {
    throw new Error(`No ${script}. Set KRYOVA_BACKEND_DIR to the backend checkout.`);
  }
  const python = process.env.KRYOVA_STAGE_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  run(python, [script, "--out", join(out, "backend")], { cwd: backendDir });
}

function parseArgs(argv) {
  const flags = new Set();
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out" || arg === "--cache") {
      values[arg.slice(2)] = argv[(index += 1)];
    } else if (arg.startsWith("--")) {
      flags.add(arg.slice(2));
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return { flags, values };
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const out = resolve(values.out ?? join(FRONTEND_DIR, "src-tauri", "bundle"));
  const cache = resolve(values.cache ?? join(tmpdir(), "kryova-desktop-cache"));
  const backendDir = resolve(process.env.KRYOVA_BACKEND_DIR ?? join(FRONTEND_DIR, "..", "Kryova-backend"));
  const manifest = readManifest();
  mkdirSync(out, { recursive: true });
  console.log(`staging into ${out}\n  downloads cached in ${cache}`);

  if (!flags.has("skip-frontend")) stageFrontend(out, { skipBuild: flags.has("skip-build") });
  if (!flags.has("skip-node")) await stageNode(out, manifest, cache);
  if (!flags.has("skip-postgres")) await stagePostgres(out, manifest, cache);
  if (!flags.has("skip-python")) await stagePython(out, manifest, cache);
  if (!flags.has("skip-backend")) stageBackend(out, backendDir);

  const problems = [
    ...layoutProblems(out),
    ...forbiddenPaths(out).map((path) => `must not ship: ${path}`),
  ];
  if (problems.length > 0) {
    console.error(`\nThe bundle is not complete:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("\nbundle complete");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
