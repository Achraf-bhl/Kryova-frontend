// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

/**
 * `/api/crash-report` (ROAD_TO_10 9.2): offered only by the desktop shell to its own machine,
 * sends nothing without `consent: true`, and forwards only to a configured `https:` endpoint.
 */

let dir: string;
const fetchMock = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kryova-crash-"));
  writeFileSync(join(dir, "backend.log"), "started\nboom postgresql://u:hunter2@h/db\n");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

function asDesktop(endpoint?: string) {
  vi.stubEnv("KRYOVA_DESKTOP", "1");
  vi.stubEnv("KRYOVA_LOG_DIR", dir);
  if (endpoint) vi.stubEnv("KRYOVA_CRASH_REPORT_URL", endpoint);
}

function get(host: string | null = "127.0.0.1:3000"): Request {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  return new Request("http://127.0.0.1:3000/api/crash-report", { headers });
}

function post(body: unknown, host: string | null = "127.0.0.1:3000"): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (host !== null) headers.set("host", host);
  return new Request("http://127.0.0.1:3000/api/crash-report", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /api/crash-report", () => {
  it("says whether a destination exists without revealing it, with scrubbed logs", async () => {
    asDesktop("https://reports.example.com/in");

    const body = await (await GET(get())).json();

    expect(body.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("reports.example.com");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(body.logs[0].name).toBe("backend.log");
  });

  it("reports an unset destination as not configured", async () => {
    asDesktop();

    expect((await (await GET(get())).json()).configured).toBe(false);
  });

  it("is a 404 on a web deployment and to a request for another host", async () => {
    vi.stubEnv("KRYOVA_LOG_DIR", dir);
    expect((await GET(get())).status).toBe(404);

    asDesktop("https://reports.example.com/in");
    expect((await GET(get("evil.example"))).status).toBe(404);
    expect((await GET(get(null))).status).toBe(404);
  });
});

describe("POST /api/crash-report", () => {
  it("forwards a consented report once, scrubbed again", async () => {
    asDesktop("https://reports.example.com/in");
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const response = await POST(
      post({ report: "boom password=letmein", consent: true }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://reports.example.com/in");
    expect(init.body).not.toContain("letmein");
  });

  it.each([{ report: "x" }, { report: "x", consent: "yes" }, { report: "x", consent: false }])(
    "sends nothing without the literal consent: true (%j)",
    async (body) => {
      asDesktop("https://reports.example.com/in");

      expect((await POST(post(body))).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("answers 501 when nothing is configured, and when the endpoint is plain http", async () => {
    asDesktop();
    expect((await POST(post({ report: "x", consent: true }))).status).toBe(501);

    asDesktop("http://reports.example.com/in");
    expect((await POST(post({ report: "x", consent: true }))).status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a report over 256 KiB", async () => {
    asDesktop("https://reports.example.com/in");

    const response = await POST(post({ report: "x".repeat(256 * 1024 + 1), consent: true }));

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the server's refusal as a 502 rather than as success", async () => {
    asDesktop("https://reports.example.com/in");
    fetchMock.mockResolvedValue(new Response("no", { status: 500 }));

    expect((await POST(post({ report: "x", consent: true }))).status).toBe(502);
  });

  it("is a 404 off the desktop shell and from another host, and 400 on a body that is not JSON", async () => {
    vi.stubEnv("KRYOVA_CRASH_REPORT_URL", "https://reports.example.com/in");
    expect((await POST(post({ report: "x", consent: true }))).status).toBe(404);

    asDesktop("https://reports.example.com/in");
    expect((await POST(post({ report: "x", consent: true }, "evil.example"))).status).toBe(404);
    expect((await POST(post("{not json"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
