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

describe("the shell's native powers (ROAD_TO_10 4.7)", () => {
  const conf = JSON.parse(text("src-tauri/tauri.conf.json")) as {
    app: { withGlobalTauri?: boolean };
    plugins?: Record<string, { desktop?: { schemes?: string[] } }>;
  };
  const capability = JSON.parse(text("src-tauri/capabilities/default.json")) as {
    windows: string[];
    permissions: string[];
    remote?: { urls: string[] };
  };
  const lib = code("src-tauri/src/lib.rs");
  const cargo = text("src-tauri/Cargo.toml");

  it("registers the kryova scheme and no other", () => {
    expect(conf.plugins?.["deep-link"]?.desktop?.schemes).toEqual(["kryova"]);
  });

  it("puts the Tauri API on the page, because there is no @tauri-apps package to import", () => {
    // Three runtime dependencies by doctrine; `scripts/check-dependencies.mjs` fails CI on a fourth.
    expect(conf.app.withGlobalTauri).toBe(true);
    const manifest = JSON.parse(text("package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies).sort()).toEqual(["next", "react", "react-dom"]);
  });

  it("grants exactly these permissions, so widening one is a decision and not a drift", () => {
    expect([...capability.permissions].sort()).toEqual([
      "core:default",
      "deep-link:default",
      "dialog:allow-open",
      "fs:allow-read-file",
      "notification:default",
      "shell:allow-open",
      "updater:default",
    ]);
  });

  it("grants nothing that writes a file, runs a command or reads a path nobody picked", () => {
    const joined = capability.permissions.join(" ");
    expect(joined).not.toMatch(/write|remove|rename|copy|mkdir|execute|spawn|kill|scope|\*/);
    expect(joined).not.toContain("fs:default");
  });

  it("gives the page IPC by its own loopback origin and by no other", () => {
    // Tauri grants IPC to a window's content by origin. The shell serves the app itself on
    // loopback; a wildcard here would hand every site a window might navigate to the same powers.
    expect(capability.windows).toEqual(["main"]);
    expect(capability.remote?.urls).toEqual(["http://127.0.0.1:3000/*"]);
  });

  it("has a crate dependency for each plugin it registers, and registers each one it depends on", () => {
    const registered = [...lib.matchAll(/tauri_plugin_([a-z_]+)::/g)].map((m) => m[1]);
    const declared = [...cargo.matchAll(/^tauri-plugin-([a-z-]+)\s*=/gm)].map((m) => m[1].replace(/-/g, "_"));

    expect([...new Set(registered)].sort()).toEqual([...new Set(declared)].sort());
    for (const plugin of ["dialog", "fs", "notification", "deep_link", "single_instance", "updater", "shell"]) {
      expect(registered, plugin).toContain(plugin);
    }
  });

  it("registers single-instance first, as the plugin requires", () => {
    const first = lib.indexOf(".plugin(");
    expect(lib.slice(first, first + 60)).toContain("tauri_plugin_single_instance");
  });

  it("answers every command the page calls, and calls only commands that exist", () => {
    const handler = /generate_handler!\[([^\]]*)\]/.exec(lib)?.[1] ?? "";
    const registered = handler.split(",").map((name) => name.trim()).filter(Boolean).sort();
    const called = [...code("src/lib/desktop-bridge.ts").matchAll(/invoke\(\s*[a-z]+,\s*"([a-z_]+)"/g)]
      .map((m) => m[1]);

    expect(called.length).toBeGreaterThan(0);
    for (const command of called) expect(registered, command).toContain(command);
    // And nothing registered goes unused: a command nobody calls is surface for nothing.
    for (const command of registered.filter((name) => name !== "backend_url")) {
      expect(called, command).toContain(command);
    }
  });

  it("emits, and listens for, the same event", () => {
    const rust = /const DEEP_LINK_EVENT: &str = "([^"]+)";/.exec(lib)?.[1];
    const page = /export const DEEP_LINK_EVENT = "([^"]+)";/.exec(text("src/lib/desktop-bridge.ts"))?.[1];

    expect(rust).toBeDefined();
    expect(rust).toBe(page);
  });

  it("registers no file associations, and says why", () => {
    // Opening a `.stp` from Explorer would have to start a conversation with it attached, and a
    // conversation cannot yet use an attachment at all (CLAUDE.md, *Reading what users attach*
    // 13; master plan P4.7). Registering the extensions first would take over the user's CAD
    // associations to open an app that cannot do what the double-click promised.
    expect(text("src-tauri/tauri.conf.json")).not.toContain("fileAssociations");
  });
});
