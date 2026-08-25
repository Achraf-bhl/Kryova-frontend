import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPlatform, PREREQUISITES, runHealthChecks } from "./system";

function mockUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectPlatform", () => {
  it("detects macOS", () => {
    mockUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    expect(detectPlatform()).toBe("macos");
  });

  it("detects Windows", () => {
    mockUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    expect(detectPlatform()).toBe("windows");
  });

  it("detects Linux", () => {
    mockUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
    expect(detectPlatform()).toBe("linux");
  });
});

describe("prerequisites", () => {
  it("has a browser and API prerequisite", () => {
    const ids = PREREQUISITES.map((p) => p.id);
    expect(ids).toContain("browser");
    expect(ids).toContain("api");
  });
});

describe("runHealthChecks", () => {
  it("returns ok when both checks pass", async () => {
    // Mock WebGL context
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        const el = originalCreateElement("canvas");
        (el as unknown as Record<string, unknown>).getContext = vi.fn(() => ({}));
        return el;
      }
      return originalCreateElement(tag);
    });

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    const results = await runHealthChecks();
    expect(results.every((r) => r.ok)).toBe(true);
    document.createElement = originalCreateElement;
  });

  it("returns not-ok for browser when WebGL is unavailable", async () => {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        const el = originalCreateElement("canvas");
        (el as unknown as Record<string, unknown>).getContext = vi.fn(() => null);
        return el;
      }
      return originalCreateElement(tag);
    });

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    const results = await runHealthChecks();
    const browserResult = results.find((r) => r.prerequisite.id === "browser");
    expect(browserResult?.ok).toBe(false);
    document.createElement = originalCreateElement;
  });

  it("returns not-ok for API when server is unreachable", async () => {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        const el = originalCreateElement("canvas");
        (el as unknown as Record<string, unknown>).getContext = vi.fn(() => ({}));
        return el;
      }
      return originalCreateElement(tag);
    });

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const results = await runHealthChecks();
    const apiResult = results.find((r) => r.prerequisite.id === "api");
    expect(apiResult?.ok).toBe(false);
    // The check catches the error internally and returns ok: false without an error message.
    expect(apiResult?.ok).toBe(false);
    document.createElement = originalCreateElement;
  });
});
