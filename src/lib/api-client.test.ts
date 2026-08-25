import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api-client";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  mockFetch.mockReset();
});

describe("api client", () => {
  it("sends cookies and requested-with header", async () => {
    Object.defineProperty(document, "cookie", {
      value: "kryova_csrf=test-csrf",
      configurable: true,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ total: 0, page: 1, page_size: 50, items: [] }),
    });

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
    Object.defineProperty(document, "cookie", {
      value: "kryova_csrf=test-csrf",
      configurable: true,
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

    await api.deleteProject("abc");
    const headers = new Headers(mockFetch.mock.calls[0][1].headers);
    expect(headers.get("x-csrf-token")).toBe("test-csrf");
  });

  it("refreshes once after unauthorized response", async () => {
    const page = { total: 0, page: 1, page_size: 50, items: [] };
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ detail: "Expired" }) })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page });

    await expect(api.listProjects()).resolves.toEqual(page);
    expect(mockFetch.mock.calls[1][0]).toContain("/auth/refresh");
  });

  it("throws on error response with detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Not found" }),
    });

    await expect(api.listProjects()).rejects.toThrow("Not found");
  });

  it("falls back to generic message when no detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(api.listProjects()).rejects.toThrow("Request failed with 500");
  });

  it("returns undefined for 204", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
    const result = await api.deleteProject("abc");
    expect(result).toBeUndefined();
  });
});
