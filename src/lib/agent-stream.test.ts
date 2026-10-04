import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRefreshState } from "./api-client";
import { streamAgent } from "./agent-stream";
import { RateLimitedError } from "./rate-limit";

/**
 * The chat transport's session handling.
 *
 * `streamAgent` used a bare `fetch`. Every other transport in the app goes
 * through `fetchWithRefresh`, which renews an expired access token and retries
 * once — so the chat was the only place in the product where a 15-minute token
 * expiry surfaced to the user, as "Could not validate credentials" on the next
 * message they sent. Pressing "Try that message again" failed the same way,
 * because nothing had renewed anything.
 */

const mockFetch = vi.fn();

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", { value, configurable: true });
}

function fail(status: number, detail?: string) {
  return { ok: false, status, json: async () => (detail ? { detail } : {}) };
}

/** A response whose SSE body yields one frame and ends. */
function stream(frames: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < frames.length
            ? { done: false, value: encoder.encode(frames[index++]) }
            : { done: true, value: undefined },
      }),
    },
  };
}

const START = 'data: {"type":"start","conversation_id":"c1"}\n\n';

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  __resetRefreshState();
  setCookie("kryova_csrf=test-csrf");
});

afterEach(() => {
  mockFetch.mockReset();
});

describe("streamAgent session handling", () => {
  it("renews an expired session and replays the message", async () => {
    mockFetch
      .mockResolvedValueOnce(fail(401, "Could not validate credentials"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      .mockResolvedValueOnce(stream([START]));

    const events: unknown[] = [];
    await streamAgent({ message: "model a spur gear" } as never, (event) => events.push(event));

    expect(events).toEqual([{ type: "start", conversation_id: "c1" }]);
    const refreshes = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes("/auth/refresh"),
    );
    expect(refreshes).toHaveLength(1);
  });

  it("sends the CSRF token the refresh issued, not the stale one", async () => {
    // `/auth/refresh` rotates `kryova_csrf` with the session. Replaying the
    // original header against the new cookie is a 403 "CSRF failure", which
    // would turn a recoverable expiry into a hard error.
    mockFetch
      .mockResolvedValueOnce(fail(401, "Could not validate credentials"))
      .mockImplementationOnce(async () => {
        setCookie("kryova_csrf=rotated-csrf");
        return { ok: true, status: 200, json: async () => ({}) };
      })
      .mockResolvedValueOnce(stream([START]));

    await streamAgent({ message: "hello" } as never, () => {});

    const retry = mockFetch.mock.calls.at(-1)!;
    expect(new Headers(retry[1].headers).get("x-csrf-token")).toBe("rotated-csrf");
  });

  it("still reports the failure when the refresh does not help", async () => {
    mockFetch
      .mockResolvedValueOnce(fail(401, "Could not validate credentials"))
      .mockResolvedValueOnce(fail(401))
      .mockResolvedValueOnce(fail(401, "Could not validate credentials"));

    await expect(
      streamAgent({ message: "hello" } as never, () => {}),
    ).rejects.toThrow("Could not validate credentials");
  });

  it("does not retry a request that was not a 401", async () => {
    mockFetch.mockResolvedValueOnce(fail(422, "load_case is invalid"));

    await expect(streamAgent({ message: "hi" } as never, () => {})).rejects.toThrow(
      "load_case is invalid",
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("streamAgent when the chat is rate-limited (ROAD_TO_10 3.2)", () => {
  function limited(retryAfter: string | null) {
    const headers = new Headers();
    if (retryAfter !== null) headers.set("Retry-After", retryAfter);
    return {
      ok: false,
      status: 429,
      headers,
      json: async () => ({ detail: "Too many requests. This limit is 20 per 60 seconds." }),
    };
  }

  it("throws an error that carries the wait, worded for sending", async () => {
    mockFetch.mockResolvedValueOnce(limited("12"));

    const error = await streamAgent({ message: "hi" } as never, () => {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(12);
    expect((error as RateLimitedError).message).toBe(
      "Too many requests. This limit is 20 per 60 seconds. You can send again in 12 s.",
    );
  });

  it("carries no wait when the server named none", async () => {
    mockFetch.mockResolvedValueOnce(limited(null));

    const error = await streamAgent({ message: "hi" } as never, () => {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });

  it("does not retry a 429", async () => {
    mockFetch.mockResolvedValueOnce(limited("1"));

    await streamAgent({ message: "hi" } as never, () => {}).catch(() => {});

    // Retrying a refusal is the tight loop the header exists to prevent.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
