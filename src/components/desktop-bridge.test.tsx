import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatiaConnectionState } from "@/types/catia";

import { DesktopBridge } from "./desktop-bridge";

/**
 * The desktop shell wired to the page (ROAD_TO_10 4.7): links in, tray status out, and
 * nothing at all in a browser. `window.__TAURI__` is a recording fake.
 */

const push = vi.fn();
// One object, as Next's own `useRouter` returns: a new one per render would re-run the
// effect that depends on it, which the real hook never does.
const router = { push, replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

let connection: CatiaConnectionState = "connecting";
const useCatiaStatus = vi.fn(() => ({ state: connection }));
vi.mock("@/hooks/use-catia-status", () => ({ useCatiaStatus: () => useCatiaStatus() }));

type Handler = (event: unknown) => void;
let waiting: unknown = [];
let nudge: Handler | undefined;
const unlisten = vi.fn();
// The shell hands each link over once, as `take_deep_links` does: what it returns is gone.
const invoke = vi.fn(async (command: string) => {
  if (command !== "take_deep_links") return undefined;
  const taken = waiting;
  waiting = [];
  return taken;
});
const listen = vi.fn(async (_event: string, handler: Handler) => {
  nudge = handler;
  return unlisten;
});

const check = vi.fn(async (): Promise<unknown> => null);

function installShell() {
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke },
    event: { listen },
    updater: { check },
  };
}

beforeEach(() => {
  waiting = [];
  nudge = undefined;
  connection = "connecting";
  push.mockReset();
  unlisten.mockReset();
  invoke.mockClear();
  listen.mockClear();
  useCatiaStatus.mockClear();
  check.mockReset();
  check.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
});

describe("in a browser", () => {
  it("renders nothing, asks nothing and opens no CATIA stream", () => {
    const { container } = render(<DesktopBridge />);

    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    // The status hook polls and holds an event stream; a browser must not pay for a tray it
    // does not have, and it is the CATIA panel's own instance that serves the page.
    expect(useCatiaStatus).not.toHaveBeenCalled();
  });
});

describe("in the desktop shell", () => {
  beforeEach(installShell);

  it("opens a link the shell was holding when the page loaded", async () => {
    waiting = ["kryova://run/abc"];

    render(<DesktopBridge />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/simulations/abc"));
  });

  it("goes to the newest valid link, and says so when it refused one", async () => {
    waiting = ["kryova://run/abc", "kryova://delete/abc", "kryova://project/p1"];

    render(<DesktopBridge />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/projects/p1"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent(/run, conversation, project/);
  });

  it("shows a link it refuses instead of doing nothing, and the notice can be dismissed", async () => {
    waiting = ["https://evil.example/run/abc"];

    render(<DesktopBridge />);

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/only opens kryova:\/\//);
    expect(push).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("collects again when the shell says another arrived", async () => {
    render(<DesktopBridge />);
    await waitFor(() => expect(listen).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();

    waiting = ["kryova://conversation/c-9"];
    nudge?.({});

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/conversations/c-9"));
  });

  it("does nothing, and shows nothing, when there is nothing waiting", async () => {
    render(<DesktopBridge />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("take_deep_links", undefined));

    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stops listening when the page goes away", async () => {
    const { unmount } = render(<DesktopBridge />);
    await waitFor(() => expect(listen).toHaveBeenCalled());
    await Promise.resolve();

    unmount();

    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it.each<[CatiaConnectionState, string]>([
    ["connected", "Kryova — CATIA connected"],
    ["offline", "Kryova — CATIA not connected"],
    ["unavailable", "Kryova — CATIA unavailable"],
  ])("tells the tray the bridge is %s", async (state, text) => {
    connection = state;

    render(<DesktopBridge />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_tray_status", { text }));
  });
});

describe("updates in the desktop shell", () => {
  beforeEach(installShell);

  const offered = (downloadAndInstall = vi.fn(async () => undefined)) => {
    check.mockResolvedValue({ version: "0.3.0", downloadAndInstall });
    return downloadAndInstall;
  };

  it("says nothing when this is the newest, and asks exactly once", async () => {
    const { rerender } = render(<DesktopBridge />);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    rerender(<DesktopBridge />);

    expect(screen.queryByText(/is available/)).toBeNull();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("offers a newer release and installs nothing until the person clicks", async () => {
    const download = offered();
    render(<DesktopBridge />);

    expect(await screen.findByText("Kryova 0.3.0 is available.")).toBeTruthy();
    expect(download).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(download).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Installing Kryova 0\.3\.0/)).toBeTruthy();
    // No second install button while one is running.
    expect(screen.queryByRole("button", { name: "Install and restart" })).toBeNull();
  });

  it("goes away on Later and does not come back this launch", async () => {
    offered();
    render(<DesktopBridge />);

    await userEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it("says why an install failed, keeps the old version, and offers it again", async () => {
    offered(
      vi.fn(async () => {
        throw new Error("signature verification failed");
      }),
    );
    render(<DesktopBridge />);

    await userEvent.click(await screen.findByRole("button", { name: "Install and restart" }));
    expect(await screen.findByText(/signature verification failed/)).toBeTruthy();
    expect(screen.getByText(/keeps working/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install and restart" })).toBeTruthy();
  });
});
