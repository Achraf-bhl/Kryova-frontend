import { describe, expect, it, vi } from "vitest";

import { INITIAL_WATCH, STRIKES_TO_FALL, next, probe, type Watch } from "./backend-watch";

describe("next", () => {
  it("does not call one failed probe an outage", () => {
    const online: Watch = { state: "online", strikes: 0 };
    const after = next(online, "unreachable");
    expect(after.state).toBe("online");
    expect(after.strikes).toBe(1);
  });

  it("falls after the configured number of failures in a row", () => {
    let watch: Watch = { state: "online", strikes: 0 };
    for (let i = 0; i < STRIKES_TO_FALL; i++) watch = next(watch, "unreachable");
    expect(watch.state).toBe("unreachable");
  });

  it("comes back on the first good probe", () => {
    const down: Watch = { state: "failing", strikes: 5 };
    expect(next(down, "online")).toEqual({ state: "online", strikes: 0 });
  });

  it("a good probe in the middle resets the count", () => {
    let watch: Watch = { state: "online", strikes: 0 };
    watch = next(watch, "unreachable");
    watch = next(watch, "online");
    watch = next(watch, "unreachable");
    expect(watch.state).toBe("online");
  });

  it("starts unknown, which is not down", () => {
    expect(INITIAL_WATCH.state).toBe("unknown");
    expect(next(INITIAL_WATCH, "unreachable").state).toBe("unknown");
  });

  it("tells a failing server from an unreachable one", () => {
    let watch = INITIAL_WATCH;
    for (let i = 0; i < STRIKES_TO_FALL; i++) watch = next(watch, "failing");
    expect(watch.state).toBe("failing");
  });
});

describe("probe", () => {
  it("reads a 503 as failing and a 401 as the server being up", async () => {
    expect(await probe("x", vi.fn().mockResolvedValue({ status: 503 }) as never)).toBe("failing");
    expect(await probe("x", vi.fn().mockResolvedValue({ status: 401 }) as never)).toBe("online");
  });

  it("reads a thrown fetch as unreachable", async () => {
    expect(await probe("x", vi.fn().mockRejectedValue(new Error("net")) as never)).toBe("unreachable");
  });

  it("does not even ask when the browser says it is offline", async () => {
    const fetcher = vi.fn();
    expect(await probe("x", fetcher as never, false)).toBe("unreachable");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
