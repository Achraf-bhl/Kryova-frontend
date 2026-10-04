// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

/**
 * `GET /api/diagnostics` (ROAD_TO_10 4.8): the log tails for "Copy diagnostics", served only to
 * the machine they are on and only by the desktop shell. A web deployment must look as though
 * the route does not exist.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kryova-route-"));
  writeFileSync(join(dir, "backend.log"), "started\nOperationalError postgresql://u:hunter2@h/db\n");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function request(host: string | null): Request {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  return new Request("http://127.0.0.1:3000/api/diagnostics", { headers });
}

function asDesktop() {
  vi.stubEnv("KRYOVA_DESKTOP", "1");
  vi.stubEnv("KRYOVA_LOG_DIR", dir);
}

describe("GET /api/diagnostics", () => {
  it("serves the tails to the desktop shell's own machine, scrubbed and uncached", async () => {
    asDesktop();

    const response = await GET(request("127.0.0.1:3000"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.logs[0].name).toBe("backend.log");
    expect(body.logs[0].tail).toContain("started");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("is a 404, as if there were no such route, on a web deployment", async () => {
    vi.stubEnv("KRYOVA_LOG_DIR", dir);

    const response = await GET(request("127.0.0.1:3000"));

    expect(response.status).toBe(404);
  });

  it("is a 404 without a log directory, even for the desktop flag", async () => {
    vi.stubEnv("KRYOVA_DESKTOP", "1");
    vi.stubEnv("KRYOVA_LOG_DIR", "");

    expect((await GET(request("127.0.0.1:3000"))).status).toBe(404);
  });

  it.each(["192.168.1.20:3000", "evil.example", "127.0.0.1.evil.example:3000"])(
    "is a 404 to a request addressed to %s, which is not this machine",
    async (host) => {
      asDesktop();

      const response = await GET(request(host));

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("started");
    },
  );

  it("is a 404 to a request with no Host header", async () => {
    asDesktop();

    expect((await GET(request(null))).status).toBe(404);
  });
});
