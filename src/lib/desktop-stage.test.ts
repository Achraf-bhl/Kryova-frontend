import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  REQUIRED_FILES,
  fetchPinned,
  forbiddenPaths,
  layoutProblems,
  readManifest,
  sha256File,
} from "../../scripts/stage-desktop.mjs";

/**
 * The installer's staging script and the shell that reads what it stages (ROAD_TO_10 4.1-4.3).
 *
 * Two files that must agree and that nothing else sees both of: `scripts/stage-desktop.mjs`
 * writes a tree and `src-tauri/src/layout.rs` goes looking for it. A rename on one side
 * builds an installer that starts nothing, and nothing about building says so -- the shell's
 * old failure was exactly that, a 90-second wait and a window that failed to load.
 *
 * Lives in `src/lib/` only because vitest collects `src/**`.
 */
const root = process.cwd();
const text = (relative: string) => readFileSync(join(root, relative), "utf8");
const scratch = () => mkdtempSync(join(tmpdir(), "kryova-stage-"));

function touch(base: string, relative: string, body = "") {
  const path = join(base, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

describe("the staging script and the shell agree on the tree", () => {
  const layout = text("src-tauri/src/layout.rs");

  it("names the same server and backend entry point", () => {
    expect(layout).toContain(`pub const FRONTEND_SERVER: &str = "frontend/server.js";`);
    expect(layout).toContain(`pub const BACKEND_ENTRY: &str = "backend/app/desktop.py";`);
    expect(REQUIRED_FILES).toContain("frontend/server.js");
    expect(REQUIRED_FILES).toContain("backend/app/desktop.py");
  });

  it("looks for the interpreter, Node and Postgres where the script puts them", () => {
    expect(REQUIRED_FILES).toContain("backend/python/python.exe");
    expect(layout).toContain(`"backend/python/python.exe"`);
    expect(REQUIRED_FILES).toContain("runtime/node/node.exe");
    expect(layout).toContain(`runtime/node/{}`);
    expect(REQUIRED_FILES).toContain("postgres/bin/pg_ctl.exe");
    expect(layout).toContain(`pub const POSTGRES_DIR: &str = "postgres";`);
    expect(layout).toContain(`exe(os, "pg_ctl")`);
  });

  it("requires exactly as many files as the shell does", () => {
    // `required()` in layout.rs builds a vec of five entries. A sixth added on one side only
    // is a file one of them believes in and the other never writes.
    const body = layout.slice(layout.indexOf("fn required("), layout.indexOf("/// What a resource"));
    const entries = body.slice(body.indexOf("vec!["), body.indexOf("]", body.indexOf("vec![")));
    const commas = entries.split("\n").filter((line) => line.trim().endsWith(",")).length;
    expect(commas).toBe(REQUIRED_FILES.length);
  });

  it("starts the bundled backend with the module the script ships", () => {
    const shell = text("src-tauri/src/lib.rs");
    expect(shell).toContain('.arg("app.desktop")');
  });
});

describe("what is pinned", () => {
  const manifest = readManifest();

  it("pins every runtime by https URL and a 64-digit hash", () => {
    for (const name of ["node", "python", "postgres"] as const) {
      expect(manifest[name].url).toMatch(/^https:\/\//);
      expect(manifest[name].sha256).toMatch(/^[0-9a-f]{64}$/);
      // Where the hash came from is part of the pin: "measured" and "read off the vendor's
      // page" are different strengths of evidence, and the file says which this one is.
      expect(manifest[name].hash_source.length).toBeGreaterThan(20);
    }
  });

  it("keeps only Postgres's bin, lib and share", () => {
    // pgAdmin, the docs, the headers and StackBuilder are most of the 914 MB zip.
    expect([...manifest.postgres.keep].sort()).toEqual(["bin", "lib", "share"]);
  });

  it("refuses a manifest entry with no hash", () => {
    const dir = scratch();
    const bad = join(dir, "runtime.json");
    writeFileSync(
      bad,
      JSON.stringify({
        node: { url: "https://x.example/n.zip" },
        python: manifest.python,
        postgres: manifest.postgres,
      }),
    );
    expect(() => readManifest(bad)).toThrow(/node.*sha256/);
  });
});

describe("a complete bundle", () => {
  it("is recognised, and a missing file is named", () => {
    const dir = scratch();
    for (const file of REQUIRED_FILES) touch(dir, file);
    expect(layoutProblems(dir)).toEqual([]);


    const missing = scratch();
    for (const file of REQUIRED_FILES.filter((f: string) => f !== "backend/python/python.exe")) {
      touch(missing, file);
    }
    expect(layoutProblems(missing)).toEqual(["missing backend/python/python.exe"]);
  });
});

describe("what the installer must never carry", () => {
  it("finds a credentials file wherever it hides", () => {
    const dir = scratch();
    touch(dir, "frontend/server.js");
    touch(dir, "backend/app/main.py");
    touch(dir, "backend/.env.local", "AI_API_KEY=not-a-real-key");
    touch(dir, "frontend/deep/er/.env");

    expect(forbiddenPaths(dir).sort()).toEqual(["backend/.env.local", "frontend/deep/er/.env"]);
  });

  it("finds the backend's tests, its venv and the 450 MB of manuals", () => {
    const dir = scratch();
    touch(dir, "backend/tests/test_x.py");
    touch(dir, "backend/venv/pyvenv.cfg");
    touch(dir, "backend/data/bm25/manual.pdf");
    touch(dir, "backend/app/main.py");

    expect(forbiddenPaths(dir).sort()).toEqual([
      "backend/data/bm25",
      "backend/tests",
      "backend/venv",
    ]);
  });

  it("does not mistake the interpreter's own directories for them", () => {
    // `Lib/venv` is the standard library and every wheel ships a `tests` directory. A scan
    // that flagged those would fail every real bundle and be switched off by the first
    // person it blocked.
    const dir = scratch();
    touch(dir, "backend/python/Lib/venv/__init__.py");
    touch(dir, "backend/python/Lib/site-packages/numpy/tests/test_x.py");
    touch(dir, "backend/app/main.py");

    expect(forbiddenPaths(dir)).toEqual([]);
  });

  it("finds the Tauri crate if a copy of it got in", () => {
    const dir = scratch();
    touch(dir, "frontend/src-tauri/Cargo.toml");
    expect(forbiddenPaths(dir)).toEqual(["frontend/src-tauri"]);
  });

  it("finds the signature of Next having traced the whole project", () => {
    // The first real staging run: one dynamic path.join in a route made the standalone output
    // take the checkout -- source, scripts, notes to the developer and `src-tauri/target`.
    const dir = scratch();
    touch(dir, "frontend/server.js");
    touch(dir, "frontend/.next/server/app.js");
    touch(dir, "frontend/src/app/page.tsx");
    touch(dir, "frontend/scripts/stage-desktop.mjs");
    touch(dir, "frontend/CLAUDE.md");
    touch(dir, "frontend/AGENTS.md");

    expect(forbiddenPaths(dir).sort()).toEqual([
      "frontend/AGENTS.md",
      "frontend/CLAUDE.md",
      "frontend/scripts",
      "frontend/src",
    ]);
  });

  it("keeps the one route that reads a runtime path from being traced as 'any file here'", () => {
    // `diagnostics.ts` joins a directory the shell names at run time. Without the ignore
    // comment Turbopack warns "Dynamic filesystem access causes tracing of the whole project"
    // and the installer grows by gigabytes. The stager's list above catches the result; this
    // names the cause.
    expect(text("src/lib/diagnostics.ts")).toMatch(/path\.join\(\/\*turbopackIgnore: true\*\/ dir, name\)/);
  });
});

describe("the staged tree", () => {
  it("is ignored by git, because it is over a gigabyte of somebody else's binaries", () => {
    // `src-tauri/bundle/` is the stager's default output. Unignored, `git add -A` in a shared
    // tree would stage a pinned CPython, every wheel and PostgreSQL.
    const lines = text(".gitignore").split("\n").map((line) => line.trim());
    expect(lines).toContain("src-tauri/bundle/");
  });
});

describe("a download is pinned", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  const body = Buffer.from("pretend this is an interpreter");
  const digest = createHash("sha256").update(body).digest("hex");

  async function serve(): Promise<{ url: string; requests: () => number }> {
    let count = 0;
    server = createServer((_request, response) => {
      count += 1;
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(body);
    });
    await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", () => ready()));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}/runtime.zip`, requests: () => count };
  }

  const quiet = () => {};

  it("is kept when its hash matches, and reused without asking again", async () => {
    const { url, requests } = await serve();
    const cache = scratch();

    const first = await fetchPinned({ url, sha256: digest }, cache, quiet);
    const second = await fetchPinned({ url, sha256: digest }, cache, quiet);

    expect(first).toBe(second);
    expect(await sha256File(first)).toBe(digest);
    expect(requests()).toBe(1);
  });

  it("is refused and deleted when its hash does not match", async () => {
    const { url } = await serve();
    const cache = scratch();
    const wrong = "0".repeat(64);

    await expect(fetchPinned({ url, sha256: wrong }, cache, quiet)).rejects.toThrow(
      /Refusing to stage a runtime that is not the one desktop-runtime.json names/,
    );
    expect(existsSync(join(cache, "runtime.zip"))).toBe(false);
  });

  it("is fetched again when the cached file is not the pinned one", async () => {
    const { url, requests } = await serve();
    const cache = scratch();
    writeFileSync(join(cache, "runtime.zip"), "a truncated or swapped file");

    const path = await fetchPinned({ url, sha256: digest }, cache, quiet);

    expect(await sha256File(path)).toBe(digest);
    expect(requests()).toBe(1);
  });
});
