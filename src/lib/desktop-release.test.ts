import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { overlayArgument, releaseOverlay } from "../../scripts/desktop-config.mjs";
import { latestJson, signedVersion } from "../../scripts/make-latest-json.mjs";

/**
 * What a release adds to the Tauri build, and the file the updater reads (ROAD_TO_10 4.1, 4.6).
 *
 * Lives in `src/lib/` only because vitest collects `src/**`; it tests `scripts/`.
 */
const text = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

const PUBKEY = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgQUJDREVGMDEyMzQ1Njc4OQpSV1Q=";
const BASE = "https://updates.example.test/kryova";
const THUMBPRINT = "0123456789ABCDEF0123456789ABCDEF01234567";
const TIMESTAMP = "https://timestamp.example.test/tsa";

describe("the release overlay", () => {
  it("is empty for an ordinary build, so tauri dev and cargo check never need a bundle or a key", () => {
    expect(releaseOverlay({ env: {} })).toEqual({});
    expect(overlayArgument(releaseOverlay({ env: {} }))).toEqual([]);
  });

  it("maps the staged tree onto the resource root when bundled", () => {
    expect(releaseOverlay({ bundled: true, env: {} })).toEqual({
      bundle: { resources: { "bundle/": "" } },
    });
  });

  it("wires an updater with one endpoint per channel, and a build belongs to one channel", () => {
    const stable = releaseOverlay({
      env: { KRYOVA_UPDATER_PUBKEY: PUBKEY, KRYOVA_UPDATE_BASE_URL: `${BASE}/` },
    }) as { plugins: { updater: { endpoints: string[]; pubkey: string } } };
    const beta = releaseOverlay({
      env: {
        KRYOVA_UPDATER_PUBKEY: PUBKEY,
        KRYOVA_UPDATE_BASE_URL: BASE,
        KRYOVA_UPDATE_CHANNEL: "beta",
      },
    }) as { plugins: { updater: { endpoints: string[] } } };

    expect(stable.plugins.updater.endpoints).toEqual([`${BASE}/stable/latest.json`]);
    expect(beta.plugins.updater.endpoints).toEqual([`${BASE}/beta/latest.json`]);
    expect(stable.plugins.updater.pubkey).toBe(PUBKEY);
  });

  it("requires the signed version, which is what stops a crafted response downgrading the app", () => {
    // The endpoint's JSON is not signed, only the artefact is. Without this a response can pair
    // a new version number with an older release's perfectly valid signature.
    const overlay = releaseOverlay({
      env: { KRYOVA_UPDATER_PUBKEY: PUBKEY, KRYOVA_UPDATE_BASE_URL: BASE },
    }) as { plugins: { updater: { requireSignedVersion: boolean } } };
    expect(overlay.plugins.updater.requireSignedVersion).toBe(true);
  });

  it("refuses half an updater rather than building one that trusts or asks the wrong party", () => {
    expect(() => releaseOverlay({ env: { KRYOVA_UPDATER_PUBKEY: PUBKEY } })).toThrow(/both/);
    expect(() => releaseOverlay({ env: { KRYOVA_UPDATE_BASE_URL: BASE } })).toThrow(/both/);
  });

  it("refuses a key that is not a public key, an http host and an unknown channel", () => {
    const env = { KRYOVA_UPDATER_PUBKEY: PUBKEY, KRYOVA_UPDATE_BASE_URL: BASE };
    expect(() => releaseOverlay({ env: { ...env, KRYOVA_UPDATER_PUBKEY: "C:\\keys\\kryova.key" } })).toThrow(
      /base64 public key/,
    );
    expect(() => releaseOverlay({ env: { ...env, KRYOVA_UPDATE_BASE_URL: "http://updates.test" } })).toThrow(
      /https/,
    );
    expect(() => releaseOverlay({ env: { ...env, KRYOVA_UPDATE_CHANNEL: "nightly" } })).toThrow(
      /stable, beta/,
    );
  });

  it("names a certificate by thumbprint with a timestamp, and carries no key or password", () => {
    const overlay = releaseOverlay({
      bundled: true,
      env: { KRYOVA_SIGN_THUMBPRINT: THUMBPRINT, KRYOVA_SIGN_TIMESTAMP_URL: TIMESTAMP },
    }) as { bundle: { resources: unknown; windows: Record<string, unknown> } };

    expect(overlay.bundle.windows).toEqual({
      certificateThumbprint: THUMBPRINT,
      digestAlgorithm: "sha256",
      timestampUrl: TIMESTAMP,
      tsp: true,
    });
    // Signing must not displace the staged tree that `bundled` maps onto the resource root.
    expect(overlay.bundle.resources).toEqual({ "bundle/": "" });
    expect(JSON.stringify(overlay)).not.toMatch(/password|pfx|private/i);
  });

  it("accepts a thumbprint as the store prints it, with spaces and either case", () => {
    const spaced = THUMBPRINT.toLowerCase().replace(/(.{4})/g, "$1 ").trim();
    const overlay = releaseOverlay({
      env: { KRYOVA_SIGN_THUMBPRINT: spaced, KRYOVA_SIGN_TIMESTAMP_URL: TIMESTAMP },
    }) as { bundle: { windows: { certificateThumbprint: string } } };
    expect(overlay.bundle.windows.certificateThumbprint).toBe(THUMBPRINT.toLowerCase());
  });

  it("refuses a signature with no timestamp, because it expires with the certificate", () => {
    expect(() => releaseOverlay({ env: { KRYOVA_SIGN_THUMBPRINT: THUMBPRINT } })).toThrow(/both/);
    expect(() => releaseOverlay({ env: { KRYOVA_SIGN_TIMESTAMP_URL: TIMESTAMP } })).toThrow(/both/);
  });

  it("refuses a thumbprint that is a path, a password or the wrong length", () => {
    const env = { KRYOVA_SIGN_TIMESTAMP_URL: TIMESTAMP };
    for (const bad of ["C:\\certs\\kryova.pfx", "hunter2", THUMBPRINT.slice(1), `${THUMBPRINT}0`]) {
      expect(() => releaseOverlay({ env: { ...env, KRYOVA_SIGN_THUMBPRINT: bad } })).toThrow(
        /40 hex characters/,
      );
    }
    expect(() =>
      releaseOverlay({ env: { KRYOVA_SIGN_THUMBPRINT: THUMBPRINT, KRYOVA_SIGN_TIMESTAMP_URL: "ftp://t" } }),
    ).toThrow(/http\(s\)/);
  });

  it("takes a signing command for a token or cloud signer, and demands the %1 that makes it sign", () => {
    const overlay = releaseOverlay({
      env: { KRYOVA_SIGN_COMMAND: "vendor-signer --file %1" },
    }) as { bundle: { windows: Record<string, unknown> } };
    expect(overlay.bundle.windows).toEqual({ signCommand: "vendor-signer --file %1" });

    expect(() => releaseOverlay({ env: { KRYOVA_SIGN_COMMAND: "vendor-signer --file" } })).toThrow(/%1/);
  });

  it("refuses to be told two ways to sign", () => {
    expect(() =>
      releaseOverlay({
        env: { KRYOVA_SIGN_COMMAND: "vendor-signer %1", KRYOVA_SIGN_THUMBPRINT: THUMBPRINT },
      }),
    ).toThrow(/two ways to sign/);
  });

  it("composes with the updater without either displacing the other", () => {
    const overlay = releaseOverlay({
      bundled: true,
      env: {
        KRYOVA_UPDATER_PUBKEY: PUBKEY,
        KRYOVA_UPDATE_BASE_URL: BASE,
        KRYOVA_SIGN_THUMBPRINT: THUMBPRINT,
        KRYOVA_SIGN_TIMESTAMP_URL: TIMESTAMP,
      },
    }) as Record<string, Record<string, unknown>>;
    expect(Object.keys(overlay).sort()).toEqual(["bundle", "plugins"]);
    expect(Object.keys(overlay.bundle).sort()).toEqual(["resources", "windows"]);
  });

  it("has no default update host: that is the release manager's to name", () => {
    expect(text("scripts/desktop-config.mjs")).not.toMatch(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[^"`'\s]*latest/);
  });
});

/** A minisign signature file as `tauri signer sign` writes it, base64-encoded as the updater expects. */
function signature(version: string | null, extra = "") {
  const trusted = ["timestamp:1700000000", "file:Kryova_x64.msi", ...(version ? [`version:${version}`] : [])]
    .join("\t");
  const body = [
    "untrusted comment: signature from tauri secret key",
    "RUQ" + "A".repeat(80),
    `trusted comment: ${trusted}${extra}`,
    "B".repeat(86),
    "",
  ].join("\n");
  return Buffer.from(body).toString("base64");
}

const URL = "https://updates.example.test/kryova/0.3.0/Kryova_0.3.0_x64_en-US.msi";
const NOW = new Date("2026-10-05T12:34:56.789Z");

describe("latest.json", () => {
  it("is the static document the updater reads, for the platform the installer is for", () => {
    const sig = signature("0.3.0");

    const doc = latestJson({ version: "0.3.0", channel: "stable", url: URL, signature: `${sig}\n`, notes: "Fixes", now: NOW });

    expect(doc).toEqual({
      version: "0.3.0",
      notes: "Fixes",
      pub_date: "2026-10-05T12:34:56Z",
      platforms: { "windows-x86_64": { signature: sig, url: URL } },
    });
  });

  it("reads the version out of the signature the way the client will", () => {
    expect(signedVersion(signature("1.2.3"))).toBe("1.2.3");
    expect(signedVersion(signature(null))).toBeNull();
    expect(signedVersion("not base64 at all !!")).toBeNull();
  });

  it("refuses a signature made for a different version than the one announced", () => {
    // Every installed app would refuse this update, and would say so one customer at a time.
    expect(() =>
      latestJson({ version: "0.3.0", channel: "stable", url: URL, signature: signature("0.2.9") }),
    ).toThrow(/signed for version 0\.2\.9, not 0\.3\.0/);
  });

  it("refuses a signature that records no version, which requireSignedVersion rejects", () => {
    expect(() =>
      latestJson({ version: "0.3.0", channel: "stable", url: URL, signature: signature(null) }),
    ).toThrow(/does not record a version/);
  });

  it("refuses an empty signature file", () => {
    expect(() => latestJson({ version: "0.3.0", channel: "stable", url: URL, signature: " \n" })).toThrow(
      /signature file is empty/,
    );
  });

  it("keeps a beta build off the stable channel and a plain release off the beta one", () => {
    expect(() =>
      latestJson({ version: "0.3.0-beta.1", channel: "stable", url: URL, signature: signature("0.3.0-beta.1") }),
    ).toThrow(/cannot be published on the stable channel/);
    expect(() =>
      latestJson({ version: "0.3.0", channel: "beta", url: URL, signature: signature("0.3.0") }),
    ).toThrow(/no pre-release tag/);
    expect(
      latestJson({ version: "0.3.0-beta.1", channel: "beta", url: URL, signature: signature("0.3.0-beta.1"), now: NOW })
        .version,
    ).toBe("0.3.0-beta.1");
  });

  it("refuses a version that is not semver, an http artefact and an unknown channel", () => {
    const sig = signature("0.3");
    expect(() => latestJson({ version: "0.3", channel: "stable", url: URL, signature: sig })).toThrow(/semantic version/);
    expect(() =>
      latestJson({ version: "0.3.0", channel: "stable", url: URL.replace("https", "http"), signature: signature("0.3.0") }),
    ).toThrow(/must be https/);
    expect(() =>
      latestJson({ version: "0.3.0", channel: "nightly", url: URL, signature: signature("0.3.0") }),
    ).toThrow(/Channel must be/);
  });
});

describe("the bundled build", () => {
  const build = text("scripts/desktop-build.mjs");

  it("bakes no checkout path into an installer", () => {
    // `option_env!` in lib.rs takes whatever the environment holds at compile time. An
    // installer carrying the build machine's paths is carrying the build machine.
    expect(build).toMatch(/if \(bundled\) \{[\s\S]*delete env\[key\][\s\S]*delete env\.KRYOVA_BACKEND_DIR/);
  });

  it("stages the tree before it builds an installer around it", () => {
    expect(build.indexOf("stage-desktop.mjs")).toBeGreaterThan(-1);
    expect(build.indexOf("stage-desktop.mjs")).toBeLessThan(build.indexOf('"build"'));
  });

  it("is reachable from npm", () => {
    const scripts = (JSON.parse(text("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["desktop:release"]).toContain("--bundled");
    expect(scripts["desktop:stage"]).toContain("stage-desktop.mjs");
  });
});
