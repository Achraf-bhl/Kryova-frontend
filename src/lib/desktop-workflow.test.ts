import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REQUIRED_FILES } from "../../scripts/stage-desktop.mjs";

/**
 * The release pipeline's claims, read as text (ROAD_TO_10 4.9).
 *
 * `.github/workflows/desktop.yml` has never run, and this file is how its promises stay true
 * until it does: it cannot say the pipeline works, only that the pipeline still says what the
 * rest of the repository depends on. Each test fails when the workflow drifts from a fact held
 * somewhere else -- the file list the shell looks for, the draft-only rule, the pinned actions.
 *
 * Lives in `src/lib/` only because vitest collects `src/**`.
 */
// CRLF folded to LF: a Windows checkout (core.autocrlf) has CRLF, and every search below is
// written in LF, so without this each job reads as missing there.
const workflow = readFileSync(join(process.cwd(), ".github/workflows/desktop.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** The text of one top-level job, from its key to the next job's key (or the end). */
function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`no job named ${name}`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("the desktop workflow's supply chain", () => {
  it("pins every action to a full commit, because a tag can be moved", () => {
    const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(5);
    for (const reference of uses) {
      expect(reference, reference).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });

  it("puts a secret only where an environment variable or an input takes it, never in a script", () => {
    const lines = workflow.split("\n").filter((line) => line.includes("${{ secrets."));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.trim(), line).toMatch(/^(token|PFX_BASE64|PFX_PASSWORD): /);
    }
  });

  it("names the loopback address, never localhost, which the browser and the bridge split on", () => {
    expect(workflow).not.toMatch(/\/\/localhost/);
    expect(workflow).toContain("http://127.0.0.1:8000/health");
  });
});

describe("what the pipeline builds", () => {
  it("builds the installer that needs no checkout, and a second job installs it", () => {
    expect(job("build")).toContain("node scripts/desktop-build.mjs --bundled --bundles msi");
    const install = job("install-test");
    expect(install).toContain("needs: build");
    expect(install).toContain("actions/download-artifact@");
    // Build and install on two runners: the build machine has Node, Python and Rust, so an app
    // that quietly used one would pass there.
    expect(install).not.toContain("actions/checkout@");
    expect(install).not.toContain("npm ci");
  });

  it("checks the installed tree against the list the shell and the stager share", () => {
    const install = job("install-test");
    const listed = [...install.matchAll(/"((?:frontend|runtime|backend|postgres)[^"]+)"/g)].map((m) =>
      m[1].replaceAll("\\", "/"),
    );
    expect(listed.sort()).toEqual([...REQUIRED_FILES].sort());
  });

  it("tests the first launch, the data's home, a clean close and an uninstall that keeps the user's data", () => {
    const install = job("install-test");
    // Starts the installed executable and asks the backend, not just that the process lives.
    expect(install).toContain("Start-Process $env:KRYOVA_EXE");
    expect(install).toContain("http://127.0.0.1:8000/health");
    // The database is under the user's data folder and nowhere in the install.
    expect(install).toContain('"pgdata\\PG_VERSION"');
    expect(install).toContain("A database was made inside the install directory");
    // A window closed by a person, then the servers are checked gone: uninstall cannot remove
    // a file a running process holds.
    expect(install).toContain("CloseMainWindow()");
    expect(install).toContain("Closing the app left");
    // Uninstall: no entry in any of the three lists, and the user's database survives.
    expect(install).toContain('"/x"');
    expect(install).toContain("is still listed as installed");
    expect(install).toContain("Uninstalling removed the user's database");
  });
});

describe("what the pipeline may publish", () => {
  it("publishes only a signed, install-tested build, and only when asked", () => {
    const publish = job("publish");
    expect(publish).toContain("needs: [build, install-test]");
    expect(publish).toContain("inputs.publish");
    expect(publish).toContain("needs.build.outputs.signed == 'true'");
  });

  it("makes a draft, because the update feed is signed offline by a person", () => {
    const publish = job("publish");
    expect(publish).toContain("gh release create");
    expect(publish).toContain("--draft");
    expect(workflow).not.toMatch(/--draft=false/);
    expect(workflow).not.toMatch(/gh release edit/);
    // The pipeline has no way to produce a signature the updater would accept, and says so.
    expect(workflow).not.toMatch(/latest\.json["']?\s*>/);
  });

  it("says out loud when nothing was published, because a skipped job reads as success", () => {
    expect(job("not-published")).toContain("GITHUB_STEP_SUMMARY");
  });
});
