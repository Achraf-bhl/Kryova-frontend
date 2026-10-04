// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOG_FILES,
  TAIL_BYTES,
  collectServerDiagnostics,
  diagnosticsDirectory,
  isLoopbackHost,
  readTail,
  redact,
} from "./diagnostics";

/**
 * What "Copy diagnostics" may read (ROAD_TO_10 4.8). Three claims, each with a way to be quietly
 * wrong: it is opt-in twice, it answers only this machine, and what it returns has been
 * scrubbed of what a log may quote.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kryova-diag-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("diagnosticsDirectory", () => {
  it("is null unless the desktop shell started this server", () => {
    expect(diagnosticsDirectory({ KRYOVA_LOG_DIR: "/logs" })).toBeNull();
    expect(diagnosticsDirectory({ KRYOVA_DESKTOP: "0", KRYOVA_LOG_DIR: "/logs" })).toBeNull();
    expect(diagnosticsDirectory({ KRYOVA_DESKTOP: "true", KRYOVA_LOG_DIR: "/logs" })).toBeNull();
  });

  it("is null without a directory, or with a blank one", () => {
    expect(diagnosticsDirectory({ KRYOVA_DESKTOP: "1" })).toBeNull();
    expect(diagnosticsDirectory({ KRYOVA_DESKTOP: "1", KRYOVA_LOG_DIR: "" })).toBeNull();
    expect(diagnosticsDirectory({ KRYOVA_DESKTOP: "1", KRYOVA_LOG_DIR: "   " })).toBeNull();
  });

  it("is the directory when both are set", () => {
    expect(diagnosticsDirectory({ KRYOVA_DESKTOP: "1", KRYOVA_LOG_DIR: " /logs " })).toBe("/logs");
  });
});

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1:3000", "127.0.0.1", "localhost:3000", "LOCALHOST", "[::1]:3000", "[::1]"])(
    "accepts %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each([
    "192.168.1.20:3000",
    "10.0.0.5",
    "evil.example",
    "evil.example:3000",
    // A name that merely *starts* with a loopback name is somebody else's.
    "127.0.0.1.evil.example:3000",
    "localhost.evil.example",
    "[::2]:3000",
    "",
  ])("refuses %s", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });

  it("refuses a request with no Host at all", () => {
    expect(isLoopbackHost(null)).toBe(false);
  });
});

describe("redact", () => {
  it("hides the password in a connection URL and keeps the rest of it", () => {
    const out = redact("sqlalchemy.exc.OperationalError: postgresql://kryova:hunter2@127.0.0.1:5432/kryova");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("postgresql://kryova:[redacted]@127.0.0.1:5432/kryova");
  });

  it("hides a bearer token and an Authorization header", () => {
    expect(redact("Authorization: Bearer abcdef1234567890")).not.toContain("abcdef1234567890");
    expect(redact("sent header bearer zyxwvutsrq0987")).not.toContain("zyxwvutsrq0987");
  });

  it("hides the session cookies and the CSRF token", () => {
    const out = redact("Cookie: kryova_access=aaa.bbb; kryova_refresh=cccddd; kryova_csrf=eee; X-CSRF-Token: fff");
    for (const secret of ["aaa.bbb", "cccddd", "eee;", "fff"]) expect(out).not.toContain(secret);
  });

  it("hides a JWT wherever it appears", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
    expect(redact(`token was ${jwt} at that point`)).not.toContain("eyJhbGci");
  });

  it("hides password, secret and key assignments", () => {
    const out = redact("password=hunter2 secret: topsecretvalue api_key=abc123def api-key: zzz999");
    for (const secret of ["hunter2", "topsecretvalue", "abc123def", "zzz999"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("hides a key as a vendor issues it", () => {
    // Built from pieces: the repository's own secret scanner reads this file too.
    const key = "sk" + "-" + "A".repeat(24);
    expect(redact(`using ${key} for the request`)).not.toContain(key);
  });

  it("leaves an ordinary traceback exactly as it was", () => {
    const line =
      '  File "/app/ai/agent.py", line 412, in run_turn\n    raise ValueError("max_tokens=100 is not allowed")';
    expect(redact(line)).toBe(line);
    expect(redact("GET /api/v1/projects -> 200 in 12 ms")).toBe("GET /api/v1/projects -> 200 in 12 ms");
    expect(redact("connecting to postgresql://127.0.0.1:5432/kryova")).toBe(
      "connecting to postgresql://127.0.0.1:5432/kryova",
    );
  });
});

describe("readTail", () => {
  it("returns a small file whole, and does not call it truncated", async () => {
    const file = join(dir, "small.log");
    writeFileSync(file, "one\ntwo\nthree\n");

    const read = await readTail(file, 1024);

    expect(read.text).toBe("one\ntwo\nthree\n");
    expect(read.truncated).toBe(false);
    expect(read.bytes).toBe(14);
  });

  it("returns the end of a big file, from a line boundary, and says it was cut", async () => {
    const file = join(dir, "big.log");
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${String(i).padStart(5, "0")}`);
    writeFileSync(file, lines.join("\n") + "\n");

    const read = await readTail(file, 200);

    expect(read.truncated).toBe(true);
    expect(read.text.length).toBeLessThanOrEqual(200);
    expect(read.text.startsWith("line ")).toBe(true);
    expect(read.text.trimEnd().endsWith("line 04999")).toBe(true);
    // Whole lines only: the half-line at the cut is dropped.
    for (const line of read.text.trimEnd().split("\n")) expect(line).toMatch(/^line \d{5}$/);
  });

  it("reads an empty file as empty", async () => {
    const file = join(dir, "empty.log");
    writeFileSync(file, "");

    expect((await readTail(file)).text).toBe("");
  });

  it("never reads more than it was asked for, however big the file is", async () => {
    const file = join(dir, "huge.log");
    writeFileSync(file, "x".repeat(2 * 1024 * 1024));

    const read = await readTail(file);

    expect(read.bytes).toBe(2 * 1024 * 1024);
    expect(read.text.length).toBeLessThanOrEqual(TAIL_BYTES);
  });

  it("rejects for a file that is not there, naming ENOENT", async () => {
    await expect(readTail(join(dir, "nope.log"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("collectServerDiagnostics", () => {
  it("is null when this was not started by the desktop shell", async () => {
    writeFileSync(join(dir, "backend.log"), "secret goings-on");

    expect(await collectServerDiagnostics({ KRYOVA_LOG_DIR: dir })).toBeNull();
  });

  it("reads the four logs in order and names the ones that are missing", async () => {
    writeFileSync(join(dir, "backend.log"), "this launch\n");
    writeFileSync(join(dir, "backend.1.log"), "the launch before\n");

    const report = await collectServerDiagnostics({ KRYOVA_DESKTOP: "1", KRYOVA_LOG_DIR: dir });

    expect(report?.logs.map((l) => l.name)).toEqual(["backend.log", "backend.1.log"]);
    expect(report?.logs[1].tail).toBe("the launch before\n");
    expect(report?.unavailable).toEqual([
      { name: "frontend.log", reason: "not present" },
      { name: "frontend.1.log", reason: "not present" },
    ]);
  });

  it("scrubs what it returns", async () => {
    writeFileSync(
      join(dir, "backend.log"),
      "OperationalError postgresql://kryova:hunter2@127.0.0.1/kryova\n",
    );

    const report = await collectServerDiagnostics({ KRYOVA_DESKTOP: "1", KRYOVA_LOG_DIR: dir });

    expect(JSON.stringify(report)).not.toContain("hunter2");
  });

  it("reads only the four fixed names, whatever else the directory holds", async () => {
    writeFileSync(join(dir, "backend.log"), "ok\n");
    writeFileSync(join(dir, "id_rsa"), "PRIVATE KEY MATERIAL");
    writeFileSync(join(dir, "backend.2.log"), "an older launch nobody asked for");

    const report = await collectServerDiagnostics({ KRYOVA_DESKTOP: "1", KRYOVA_LOG_DIR: dir });

    expect(JSON.stringify(report)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(report)).not.toContain("an older launch");
    expect(LOG_FILES).toEqual(["backend.log", "backend.1.log", "frontend.log", "frontend.1.log"]);
  });

  it("says why a log could not be read, rather than pretending it was empty", async () => {
    mkdirSync(join(dir, "frontend.log"));

    const report = await collectServerDiagnostics({ KRYOVA_DESKTOP: "1", KRYOVA_LOG_DIR: dir });

    expect(report?.unavailable.find((u) => u.name === "frontend.log")?.reason).toMatch(
      /^could not be read \(EISDIR\)$/,
    );
  });

  it("carries the time it was read and the runtime it ran on", async () => {
    const report = await collectServerDiagnostics(
      { KRYOVA_DESKTOP: "1", KRYOVA_LOG_DIR: dir },
      new Date("2026-10-05T12:00:00Z"),
    );

    expect(report?.generated_at).toBe("2026-10-05T12:00:00.000Z");
    expect(report?.node).toBe(process.version);
  });
});
