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
