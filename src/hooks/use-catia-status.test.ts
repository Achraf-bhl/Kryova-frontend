import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatiaEventStreamHandlers } from "@/lib/catia-events";
import type { CatiaStatus } from "@/types/catia";

class MockApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const catiaStatus = vi.fn<() => Promise<CatiaStatus>>();
const openCatiaEventStream = vi.fn<(handlers: CatiaEventStreamHandlers) => () => void>();

vi.mock("@/lib/api-client", () => ({
  api: { catiaStatus: (...args: unknown[]) => catiaStatus(...(args as [])) },
  ApiError: MockApiError,
}));

vi.mock("@/lib/catia-events", () => ({
  openCatiaEventStream: (handlers: CatiaEventStreamHandlers) => openCatiaEventStream(handlers),
}));

const { useCatiaStatus } = await import("@/hooks/use-catia-status");

const online: CatiaStatus = {
  connected: true,
  enabled: true,
  backend: "catia",
  paired_devices: 1,
  document: { doc_name: "Bracket.CATPart", latest_checkpoint_id: "c1", bound_at: "2026-08-29T09:00:00Z" },
  device_id: "d1",
  device_name: "Office desktop",
  hostname: "WS-ENG-04",
  catia_version: "V5-6R2021",
  bridge_version: "1.0.0",
  mock: false,
  capabilities: ["part"],
  ui_language: "de",
  queue_depth: 0,
  connected_since: "2026-08-29T08:00:00Z",
};

/**
 * `GET /catia/status` on `GEOMETRY_BACKEND=occt`: `connected: true` — a tool
 * call will succeed — and **not one of the device fields**. Written out in full
 * rather than spread from `online`, because the absence is the whole point.
 */
const openKernel: CatiaStatus = {
  connected: true,
  enabled: true,
  backend: "occt",
  backend_version: "OCCT 7.9.3",
  paired_devices: 0,
  operations_implemented: 116,
  operations_declared: 201,
  open_documents: 1,
  document: { doc_name: "Part", evicted: false },
  detail:
    "Geometry is being built by the open kernel in this process — no CATIA seat is involved, and none is needed.",
};

const offline: CatiaStatus = {
  connected: false,
  enabled: true,
  backend: "catia",
  paired_devices: 0,
  document: null,
  detail: "No workstation has been paired with this account yet.",
};

beforeEach(() => {
  catiaStatus.mockReset();
  openCatiaEventStream.mockReset();
  openCatiaEventStream.mockReturnValue(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCatiaStatus", () => {
  it("reports a connected workstation and names it", async () => {
    catiaStatus.mockResolvedValue(online);
    const { result } = renderHook(() => useCatiaStatus("conv-1"));

    // Before the first answer there is no claim either way.
    expect(result.current.state).toBe("connecting");

    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.detail).toContain("Office desktop");
    expect(result.current.detail).toContain("V5-6R2021");
    expect(result.current.status?.document?.doc_name).toBe("Bracket.CATPart");
  });

  it("passes the conversation id, because the bound document is per-conversation", async () => {
    catiaStatus.mockResolvedValue(online);
    renderHook(() => useCatiaStatus("conv-42"));

    await waitFor(() => expect(catiaStatus).toHaveBeenCalledWith("conv-42"));
  });

  it("does not describe the open kernel as a workstation it cannot name", async () => {
    // The bug: `connected: true` is true of the open kernel too, and the seat
    // branch reads `device_name` and `catia_version` off it. Both are absent,
    // so the chip's tooltip and its screen-reader text read
    // "undefined is connected, running CATIA" on every `GEOMETRY_BACKEND=occt`
    // deployment — a sentence naming a machine that does not exist, on the one
    // backend where no machine is involved at all.
    catiaStatus.mockResolvedValue(openKernel);
    const { result } = renderHook(() => useCatiaStatus("conv-1"));

    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.detail).not.toContain("undefined");
    expect(result.current.detail).toContain("open kernel");
  });

  it("repeats the backend's reason when nothing is connected", async () => {
    catiaStatus.mockResolvedValue(offline);
    const { result } = renderHook(() => useCatiaStatus(null));

    await waitFor(() => expect(result.current.state).toBe("offline"));
    expect(result.current.detail).toBe("No workstation has been paired with this account yet.");
  });

  it("treats a missing bridge endpoint as unavailable, not as an error to shout about", async () => {
    catiaStatus.mockRejectedValue(new MockApiError(404, "Not Found"));
    const { result } = renderHook(() => useCatiaStatus(null));

    await waitFor(() => expect(result.current.state).toBe("unavailable"));
    expect(result.current.detail).toMatch(/no CATIA bridge configured/i);
  });

  it("collects daemon events and drops the stream's own handshake frame", async () => {
    catiaStatus.mockResolvedValue(online);
    const { result } = renderHook(() => useCatiaStatus(null));

    await waitFor(() => expect(openCatiaEventStream).toHaveBeenCalled());
    const handlers = openCatiaEventStream.mock.calls[0][0];

    handlers.onEvent({ event: "stream_open", at: "2026-08-29T09:00:00Z", data: {} });
    handlers.onEvent({ event: "parameters_changed", at: "2026-08-29T09:00:01Z", data: {} });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.lastEvent?.event).toBe("parameters_changed");
  });

  it("reconnects after a stream that never opened", async () => {
    vi.useFakeTimers();
    catiaStatus.mockResolvedValue(offline);
    renderHook(() => useCatiaStatus(null));

    expect(openCatiaEventStream).toHaveBeenCalledTimes(1);

    // The regression this covers: the old reconnect only fired when an
    // EventSource already existed in CLOSED state, so the guaranteed
    // first-failure path — nothing ever connected — never retried at all.
    openCatiaEventStream.mock.calls[0][0].onError?.();
    await vi.advanceTimersByTimeAsync(2_500);

    expect(openCatiaEventStream).toHaveBeenCalledTimes(2);
  });

  it("backs off rather than hammering a backend that is down", async () => {
    vi.useFakeTimers();
    catiaStatus.mockResolvedValue(offline);
    renderHook(() => useCatiaStatus(null));

    openCatiaEventStream.mock.calls[0][0].onError?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(openCatiaEventStream).toHaveBeenCalledTimes(2);

    openCatiaEventStream.mock.calls[1][0].onError?.();
    // Second failure waits 4 s, so 2 s is not yet enough.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(openCatiaEventStream).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(openCatiaEventStream).toHaveBeenCalledTimes(3);
  });
});
