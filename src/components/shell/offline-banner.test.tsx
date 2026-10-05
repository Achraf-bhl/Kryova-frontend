import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfflineBanner } from "@/components/shell/offline-banner";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("OfflineBanner", () => {
  it("says nothing while the server answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const { container } = render(<OfflineBanner />);
    await tick(100);
    expect(container).toBeEmptyDOMElement();
  });

  it("waits for two failures, then says how many features need the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const { container } = render(<OfflineBanner />);
    await tick(100);
    expect(container).toBeEmptyDOMElement();
    await tick(20_000);
    expect(screen.getByRole("status")).toHaveTextContent(/No connection to Kryova/);
    expect(screen.getByRole("status")).toHaveTextContent(/need the server/);
    expect(screen.getByText(/Read the handbook/)).toBeInTheDocument();
  });

  it("clears on the first good probe", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("net"))
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<OfflineBanner />);
    await tick(100);
    await tick(20_000);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await tick(20_000);
    expect(container).toBeEmptyDOMElement();
  });
});
