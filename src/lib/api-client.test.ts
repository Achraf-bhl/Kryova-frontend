import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRefreshState, api } from "./api-client";

const mockFetch = vi.fn();

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", { value, configurable: true });
}

/** A resolved fetch response stub. */
function ok(body?: unknown, status = 200) {
  return { ok: true, status, json: async () => body ?? {} };
}

function fail(status: number, detail?: string) {
  return { ok: false, status, json: async () => (detail ? { detail } : {}) };
}

/** A pending response that the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function refreshCallCount(): number {
  return mockFetch.mock.calls.filter((call) => String(call[0]).includes("/auth/refresh")).length;
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  __resetRefreshState();
  setCookie("kryova_csrf=test-csrf");
});

afterEach(() => {
  mockFetch.mockReset();
});

describe("api client", () => {
  it("sends cookies and requested-with header", async () => {
    mockFetch.mockResolvedValueOnce(ok({ total: 0, page: 1, page_size: 50, items: [] }));

    await api.listProjects();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/projects"),
      expect.objectContaining({
        credentials: "include",
        headers: expect.any(Headers),
      }),
    );
    const call = mockFetch.mock.calls[0];
    const headers = new Headers(call[1].headers);
    expect(headers.get("x-requested-with")).toBe("kryova");
  });

  it("adds CSRF header for mutations", async () => {
    mockFetch.mockResolvedValueOnce(ok(undefined, 204));

    await api.deleteProject("abc");
    const headers = new Headers(mockFetch.mock.calls[0][1].headers);
    expect(headers.get("x-csrf-token")).toBe("test-csrf");
  });

  it("refreshes once after unauthorized response", async () => {
    const page = { total: 0, page: 1, page_size: 50, items: [] };
    mockFetch
      .mockResolvedValueOnce(fail(401, "Expired"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok(page));

    await expect(api.listProjects()).resolves.toEqual(page);
    expect(mockFetch.mock.calls[1][0]).toContain("/auth/refresh");
  });

  it("throws on error response with detail", async () => {
    mockFetch.mockResolvedValueOnce(fail(404, "Not found"));
    await expect(api.listProjects()).rejects.toThrow("Not found");
  });

  it("falls back to generic message when no detail", async () => {
    mockFetch.mockResolvedValueOnce(fail(500));
    await expect(api.listProjects()).rejects.toThrow("Request failed with 500");
  });

  it("returns undefined for 204", async () => {
    mockFetch.mockResolvedValueOnce(ok(undefined, 204));
    const result = await api.deleteProject("abc");
    expect(result).toBeUndefined();
  });

  it("surfaces the original 401 when the refresh itself fails", async () => {
    mockFetch.mockResolvedValueOnce(fail(401, "Expired")).mockResolvedValueOnce(fail(401));

    await expect(api.listProjects()).rejects.toThrow("Expired");
    expect(refreshCallCount()).toBe(1);
    // No third call: a failed refresh must not trigger a pointless retry.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not try to refresh a failing refresh call", async () => {
    mockFetch.mockResolvedValue(fail(401, "Missing refresh token"));
    await expect(api.logout()).rejects.toThrow();
    expect(refreshCallCount()).toBe(1);
  });
});

describe("single-flight refresh", () => {
  it("issues exactly one refresh for concurrent 401s", async () => {
    // The backend rotates refresh tokens: a second concurrent refresh would
    // present the token the first one already burned and log the user out.
    const gate = deferred<unknown>();
    const page = { total: 0, page: 1, page_size: 50, items: [] };

    mockFetch.mockImplementation((url: string) => {
      const path = String(url);
      if (path.includes("/auth/refresh")) return gate.promise;
      if (mockFetch.mock.calls.filter((c) => !String(c[0]).includes("refresh")).length <= 3) {
        // First pass for all three requests: everyone gets a 401.
        return Promise.resolve(fail(401, "Expired"));
      }
      return Promise.resolve(ok(path.includes("/materials") ? { materials: [] } : page));
    });

    const inFlight = Promise.all([
      api.listProjects(),
      api.listMaterials(),
      api.listGeometry("proj-1"),
    ]);

    // Let all three original requests 401 and queue behind the refresh.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshCallCount()).toBe(1);

    gate.resolve(ok());
    await inFlight;

    expect(refreshCallCount()).toBe(1);
  });

  it("allows a fresh refresh once the previous one has settled", async () => {
    const page = { total: 0, page: 1, page_size: 50, items: [] };
    mockFetch
      .mockResolvedValueOnce(fail(401))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok(page))
      .mockResolvedValueOnce(fail(401))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok(page));

    await api.listProjects();
    await api.listProjects();

    expect(refreshCallCount()).toBe(2);
  });

  it("treats a network failure during refresh as a failed refresh", async () => {
    mockFetch
      .mockResolvedValueOnce(fail(401, "Expired"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(api.listProjects()).rejects.toThrow("Expired");
  });
});

describe("upload transport", () => {
  it("retries a chunk upload through a refresh on 401", async () => {
    // A chunked CAD upload can easily outlive a 15-minute access token; dying
    // partway through is the difference between a resumable hiccup and a lost
    // 200 MB transfer.
    mockFetch
      .mockResolvedValueOnce(fail(401, "Expired"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok({}));

    await expect(api.uploadChunk("upload-1", 3, new Blob(["x"]))).resolves.toBeUndefined();
    expect(refreshCallCount()).toBe(1);
    expect(mockFetch.mock.calls[2][0]).toContain("/media/uploads/upload-1/chunks/3");
  });

  it("sends CSRF and requested-with headers on uploads", async () => {
    mockFetch.mockResolvedValueOnce(ok({}));
    await api.uploadChunk("upload-1", 0, new Blob(["x"]));
    const headers = new Headers(mockFetch.mock.calls[0][1].headers);
    expect(headers.get("x-csrf-token")).toBe("test-csrf");
    expect(headers.get("x-requested-with")).toBe("kryova");
    expect(headers.get("content-type")).toBe("application/octet-stream");
  });

  it("reports the backend's message when an upload is rejected", async () => {
    mockFetch.mockResolvedValueOnce(fail(413, "File exceeds the 500 MB limit"));
    await expect(api.uploadChunk("upload-1", 0, new Blob(["x"]))).rejects.toThrow(
      "File exceeds the 500 MB limit",
    );
  });
});

describe("binary surface transport", () => {
  it("retries the binary surface request through a refresh on 401", async () => {
    const buffer = new ArrayBuffer(32);
    const view = new DataView(buffer);
    view.setUint8(0, 0x4b); // K
    view.setUint8(1, 0x52); // R
    view.setUint8(2, 0x59); // Y
    view.setUint8(3, 0x4f); // O
    view.setUint32(4, 1, true);

    mockFetch
      .mockResolvedValueOnce(fail(401, "Expired"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => buffer });

    const field = await api.surfaceFieldBinary("proj", "sim");
    expect(field.positions).toHaveLength(0);
    expect(refreshCallCount()).toBe(1);
  });

  it("surfaces the 409 the backend returns while a job is still running", async () => {
    mockFetch.mockResolvedValueOnce(
      fail(409, "Simulation is RUNNING; results are not available"),
    );
    await expect(api.surfaceFieldBinary("proj", "sim")).rejects.toThrow(
      "Simulation is RUNNING; results are not available",
    );
  });
});
