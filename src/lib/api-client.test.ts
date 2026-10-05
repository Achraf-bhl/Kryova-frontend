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

describe("conversation search, pin, branch and rewind (ROAD_TO_10 2.5 and 2.6)", () => {
  const lastCall = () => {
    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    return { url: String(url), init: init as RequestInit };
  };

  it("sends a search as `q`, encoded, and sends none when there is none", async () => {
    mockFetch.mockResolvedValue(ok({ total: 0, page: 1, page_size: 30, items: [] }));

    await api.listConversations(1, 30, "50% & M6");
    expect(lastCall().url).toContain("&q=50%25%20%26%20M6");

    await api.listConversations();
    expect(lastCall().url).not.toContain("q=");
  });

  it("pins and unpins with a PATCH carrying only `pinned`, and the CSRF header", async () => {
    mockFetch.mockResolvedValue(ok({}));

    await api.setConversationPinned("c-1", true);

    const { url, init } = lastCall();
    expect(url).toContain("/ai/conversations/c-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ pinned: true });
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("test-csrf");
  });

  it("branches at a named answer, or at the newest when none is named", async () => {
    mockFetch.mockResolvedValue(ok({ conversation_id: "b-1" }));

    await api.branchConversation("c-1", 3);
    expect(lastCall().url).toContain("/ai/conversations/c-1/branch");
    expect(lastCall().init.method).toBe("POST");
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ from_sequence: 3 });

    await api.branchConversation("c-1");
    // Sequence 0 is a real message; "nothing named" must not be confused with it.
    expect(JSON.parse(String(lastCall().init.body))).toEqual({});

    await api.branchConversation("c-1", 0);
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ from_sequence: 0 });
  });

  it("rewinds with a POST and no body, and hands back the server's refusal in words", async () => {
    mockFetch.mockResolvedValueOnce(ok({ message: "again", removed_messages: 2 }));
    await expect(api.rewindConversation("c-1")).resolves.toEqual({
      message: "again",
      removed_messages: 2,
    });
    expect(lastCall().url).toContain("/ai/conversations/c-1/rewind");
    expect(lastCall().init.method).toBe("POST");

    mockFetch.mockResolvedValueOnce(fail(409, "That turn changed things (catia_pad)."));
    await expect(api.rewindConversation("c-1")).rejects.toMatchObject({
      status: 409,
      message: "That turn changed things (catia_pad).",
    });
  });
});

describe("checkpoint, approval and restore calls (ROAD_TO_10 5.7)", () => {
  const lastCall = () => {
    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    return { url: String(url), init: init as RequestInit };
  };

  it("lists a conversation's checkpoints with a GET, the id encoded", async () => {
    mockFetch.mockResolvedValue(ok([]));

    await api.listCatiaCheckpoints("c/1");

    expect(lastCall().url).toContain("/catia/conversations/c%2F1/checkpoints");
    expect(lastCall().init.method ?? "GET").toBe("GET");
  });

  it("asks for an approval of `catia_restore`, bound to the conversation and checkpoint", async () => {
    mockFetch.mockResolvedValue(ok({ approval_token: "t", expires_in_seconds: 300 }));

    await api.approveCatiaRestore("c-1", "cp-9");

    const { url, init } = lastCall();
    expect(url).toContain("/catia/approvals");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      tool: "catia_restore",
      conversation_id: "c-1",
      checkpoint_id: "cp-9",
    });
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("test-csrf");
  });

  it("sends the restore with the token in the body, never in the URL", async () => {
    mockFetch.mockResolvedValue(ok({ restored_checkpoint_id: "cp-9", label: "x", message: "m" }));

    await api.restoreCatiaCheckpoint("c-1", "cp-9", "1700000000.sig");

    const { url, init } = lastCall();
    expect(url).toContain("/catia/conversations/c-1/restore");
    expect(url).not.toContain("1700000000");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      checkpoint_id: "cp-9",
      approval_token: "1700000000.sig",
    });
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("test-csrf");
  });

  it("hands back the server's refusal in words", async () => {
    mockFetch.mockResolvedValue(fail(403, "The approval expired before the operation ran."));

    await expect(api.restoreCatiaCheckpoint("c-1", "cp-9", "old")).rejects.toMatchObject({
      status: 403,
      message: "The approval expired before the operation ran.",
    });
  });
});

describe("project memory calls (ROAD_TO_10 2.7)", () => {
  const lastCall = () => {
    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    return { url: String(url), init: init as RequestInit };
  };

  it("reads one page of up to a hundred, which is every fact a project may keep", async () => {
    mockFetch.mockResolvedValueOnce(ok({ items: [], total: 0, page: 1, page_size: 100, limit: 40 }));
    await api.listProjectMemory("p-1");

    expect(lastCall().url).toContain("/projects/p-1/memory?page=1&page_size=100");
    expect(lastCall().init.method ?? "GET").toBe("GET");
  });

  it("adds with a POST of the text, carrying the CSRF token", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "m-1" }, 201));
    await api.addProjectMemory("p-1", "Units are mm.");

    expect(lastCall().url).toMatch(/\/projects\/p-1\/memory$/);
    expect(lastCall().init.method).toBe("POST");
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ text: "Units are mm." });
    expect(new Headers(lastCall().init.headers).get("x-csrf-token")).toBe("test-csrf");
  });

  it("rewords with a PATCH, not a POST that would add a second fact", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "m-1" }));
    await api.editProjectMemory("p-1", "m-1", "Units are mm and N.");

    expect(lastCall().url).toMatch(/\/projects\/p-1\/memory\/m-1$/);
    expect(lastCall().init.method).toBe("PATCH");
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ text: "Units are mm and N." });
    expect(new Headers(lastCall().init.headers).get("x-csrf-token")).toBe("test-csrf");
  });

  it("confirms by POST to the confirm path, with no body", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "m-1" }));
    await api.confirmProjectMemory("p-1", "m-1");

    expect(lastCall().url).toMatch(/\/projects\/p-1\/memory\/m-1\/confirm$/);
    expect(lastCall().init.method).toBe("POST");
    expect(lastCall().init.body).toBeUndefined();
    expect(new Headers(lastCall().init.headers).get("x-csrf-token")).toBe("test-csrf");
  });

  it("forgets with a DELETE and tolerates the empty 204", async () => {
    mockFetch.mockResolvedValueOnce(ok(undefined, 204));
    await expect(api.forgetProjectMemory("p-1", "m-1")).resolves.toBeUndefined();

    expect(lastCall().url).toMatch(/\/projects\/p-1\/memory\/m-1$/);
    expect(lastCall().init.method).toBe("DELETE");
    // A delete is a mutation: without the token the server refuses it.
    expect(new Headers(lastCall().init.headers).get("x-csrf-token")).toBe("test-csrf");
  });

  it("hands back the server's refusal in words", async () => {
    mockFetch.mockResolvedValueOnce(fail(409, "This project already holds 40 facts."));
    await expect(api.addProjectMemory("p-1", "x")).rejects.toMatchObject({
      status: 409,
      message: "This project already holds 40 facts.",
    });
  });
});

describe("a rate-limited answer (ROAD_TO_10 3.2)", () => {
  function limited(retryAfter: string | null, detail = "Too many requests. This limit is 20 per 60 seconds.") {
    const headers = new Headers();
    if (retryAfter !== null) headers.set("Retry-After", retryAfter);
    return { ok: false, status: 429, headers, json: async () => ({ detail }) };
  }

  it("says when to come back, in the server's own sentence plus the wait", async () => {
    mockFetch.mockResolvedValueOnce(limited("12"));

    await expect(api.listProjects()).rejects.toMatchObject({
      status: 429,
      message: "Too many requests. This limit is 20 per 60 seconds. You can try again in 12 s.",
      retryAfterSeconds: 12,
    });
  });

  it("states no wait for a 429 that is not about time", async () => {
    mockFetch.mockResolvedValueOnce(
      limited(null, "You already have 3 simulation(s) queued or running, which is the limit of 3."),
    );

    await expect(api.listProjects()).rejects.toMatchObject({
      status: 429,
      message: "You already have 3 simulation(s) queued or running, which is the limit of 3.",
      retryAfterSeconds: null,
    });
  });

  it("does not add a wait to any other error", async () => {
    mockFetch.mockResolvedValueOnce(fail(409, "That fact is already held."));

    await expect(api.listProjects()).rejects.toMatchObject({
      status: 409,
      message: "That fact is already held.",
      retryAfterSeconds: null,
    });
  });
});
