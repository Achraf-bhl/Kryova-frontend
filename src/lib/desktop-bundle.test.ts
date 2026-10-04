import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One installer technology per platform — master plan P9 task 4, found 2026-09-19.
 *
 * `bundle.targets` listed both `msi` and `nsis`, both per-machine, both installing into
 * `C:\Program Files\Kryova`. The first real install on the Windows seat left **two**
 * "Kryova" rows in Apps & features: 0.1.2 registered by the NSIS installer
 * (`…\Kryova\uninstall.exe`) and 0.2.0 by the MSI (`MsiExec /X{C7DA910E-…}`). The WiX
 * `upgradeCode` makes one MSI supersede the last — but an MSI does not know an NSIS
 * install exists, and an NSIS installer does not know about an MSI. Running the stale
 * uninstaller deletes files the MSI believes it owns.
 *
 * Nothing about building showed this: both bundles built cleanly for two weeks. It took
 * installing one over the other.
 *
 * Lives in `src/lib/` only because vitest collects `src/**`; it tests `src-tauri/`.
 */
const conf = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8"),
) as {
  bundle: {
    targets: string[];
    windows?: { wix?: { upgradeCode?: string }; nsis?: unknown };
  };
};

const WINDOWS_INSTALLERS = ["msi", "nsis"] as const;

describe("the Windows desktop bundle", () => {
  it("ships exactly one installer technology", () => {
    const windows = conf.bundle.targets.filter((target) =>
      (WINDOWS_INSTALLERS as readonly string[]).includes(target),
    );
    expect(windows).toEqual(["msi"]);
  });

  it("carries no NSIS settings that would imply a second installer", () => {
    expect(conf.bundle.windows?.nsis).toBeUndefined();
  });

  it("keeps a fixed WiX upgrade code, so a newer MSI supersedes an older one", () => {
    // Changing it makes every future MSI a *new* product, and every upgrade a second row
    // in Apps & features — the same defect, arriving from the MSI side instead.
    expect(conf.bundle.windows?.wix?.upgradeCode).toBe(
      "6f6c5c1e-9a2b-5d4e-8f37-2b9c4a1d7e60",
    );
  });
});

/**
 * The desktop shell's defaults, which Windows turns into a blank "Failed to fetch"
 * (ROAD_TO_10 4.4, found 2026-10-04).
 *
 * Three things were wrong at once and none of them failed a build. The setup script
 * made `.venv` where the shell looks for `venv`; it wrote a SQLite `DATABASE_URL` the
 * backend refuses at startup; and the Tauri config still allowed the Ollama port that
 * was removed with the local models, while naming `localhost` where Windows needs the
 * numeric address — Chromium resolves `localhost` to `::1`, and uvicorn is started on
 * `127.0.0.1` only. These read the files, because the thing being guarded is the
 * agreement between them and nothing else sees both sides.
 */
const text = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
/** The file without its `//` comment lines: a comment may explain a mistake, code may not make it. */
const code = (relative: string) =>
  text(relative)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

describe("the desktop shell's local addresses", () => {
  it("allows no port that belongs to a removed local model", () => {
    expect(text("src-tauri/tauri.conf.json")).not.toContain("11434");
  });

  it("names no `localhost` in the Tauri config", () => {
    expect(text("src-tauri/tauri.conf.json")).not.toContain("localhost");
  });

  it("points the webview and the API default at the numeric address", () => {
    const shell = code("src-tauri/src/lib.rs");
    expect(shell).not.toContain("localhost");
    expect(shell).toContain("127.0.0.1");
  });

  it("builds the bundle against the same host the window is served from", () => {
    expect(text("scripts/desktop-build.mjs")).toContain("http://127.0.0.1:8000/api/v1");
  });

  it("serves the window from the host the Content-Security-Policy allows", () => {
    const conf = JSON.parse(text("src-tauri/tauri.conf.json")) as {
      build: { devUrl: string; frontendDist: string };
      app: { security: { csp: string } };
    };
    for (const url of [conf.build.devUrl, conf.build.frontendDist]) {
      expect(conf.app.security.csp).toContain(new URL(url).origin);
    }
  });
});

describe("the setup script agrees with the shell about the backend", () => {
  it("does not create a virtual environment of its own", () => {
    // The shell looks for `venv`. The script made `.venv`, so a freshly set-up
    // checkout started no backend. The backend's own setup script is the one place
    // that knows the name, so this one asks it instead of repeating it.
    const setup = code("scripts/setup.mjs");
    expect(setup).not.toContain(".venv");
    expect(setup).toContain("setup.ps1");
    expect(setup).toContain("setup.sh");
  });

  it("never writes a database URL the backend refuses", () => {
    expect(code("scripts/setup.mjs")).not.toContain("sqlite");
  });

  it("looks for the same environment name the backend's script creates", () => {
    const shell = code("src-tauri/src/lib.rs");
    expect(shell).toContain('.join("venv")');
    expect(shell).not.toContain('.join(".venv")');
  });

  it("offers the numeric address as every default", () => {
    for (const file of ["scripts/setup.mjs", "scripts/setup.sh", "scripts/setup.ps1"]) {
      expect(text(file)).toContain("http://127.0.0.1:8000/api/v1");
      expect(text(file)).not.toContain("[http://localhost");
    }
  });
});


describe("the shell's own server is not open to the network (ROAD_TO_10 4.8)", () => {
  // `next start` listens on every interface unless told. The diagnostics route serves log
  // tails, and the route's own Host check is the second lock; this is the first.
  it("binds the frontend to the numeric loopback address", () => {
    const shell = code("src-tauri/src/lib.rs");
    expect(shell).toMatch(/\.arg\("-H"\)\s*\.arg\("127\.0\.0\.1"\)/);
  });

  it("starts the frontend with the two variables the diagnostics route requires", () => {
    const shell = code("src-tauri/src/lib.rs");
    expect(shell).toContain('"KRYOVA_DESKTOP"');
    expect(shell).toContain('"KRYOVA_LOG_DIR"');
  });

  it("has the route its own comments say reads the logs", () => {
    // A comment naming a file the change did not create is how a docstring comes to promise
    // a capability that is not there.
    expect(text("src-tauri/src/lib.rs")).toContain("src/app/api/diagnostics");
    expect(() => text("src/app/api/diagnostics/route.ts")).not.toThrow();
  });
});
