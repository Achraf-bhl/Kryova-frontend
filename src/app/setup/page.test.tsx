import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigation } from "@/lib/startup-watch";

import SetupPage from "./page";

/**
 * The setup page in its two modes (ROAD_TO_10 4.3): the checklist a person runs when
 * something is wrong, and the "still starting" page the desktop shell opens the window on
 * while the backend makes its database.
 */

let apiUp = false;
const apiCheck = vi.fn(async () => apiUp);

vi.mock("@/lib/system", async () => {
  const actual = await vi.importActual<typeof import("@/lib/system")>("@/lib/system");
  const api = { ...actual.PREREQUISITES.find((item) => item.id === "api")!, check: () => apiCheck() };
  const browser = { ...actual.PREREQUISITES.find((item) => item.id === "browser")!, check: async () => true };
  return {
    ...actual,
    PREREQUISITES: [browser, api],
    runHealthChecks: async () => [
      { prerequisite: browser, ok: true },
      { prerequisite: api, ok: await apiCheck(), error: "The API server is not reachable." },
    ],
  };
});

const replace = vi.spyOn(navigation, "replace").mockImplementation(() => {});

function open(search: string) {
  window.history.replaceState({}, "", `/setup${search}`);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  apiUp = false;
  apiCheck.mockClear();
  replace.mockClear();
  global.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  open("");
});

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}

describe("while the desktop app is starting", () => {
  beforeEach(() => open("?starting=1"));

  it("shows a calm message, not the checklist and not an error", async () => {
    render(<SetupPage />);
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("Starting Kryova…");
    expect(screen.queryByText(/API server is not reachable/)).not.toBeInTheDocument();
    expect(screen.queryByText("Retry checks")).not.toBeInTheDocument();
    // One question per tick: the poll's. The checklist's own run would be a second, hidden
    // behind a page that never shows its answer.
    expect(apiCheck).toHaveBeenCalledTimes(1);
  });

  it("keeps asking the API, and moves on to the app the moment it answers", async () => {
    render(<SetupPage />);
    await settle();
    expect(replace).not.toHaveBeenCalled();

    apiUp = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("explains the first launch when it is slow, and offers diagnostics when it is very slow", async () => {
    render(<SetupPage />);
    await settle();
    expect(screen.queryByText(/Copy diagnostics/)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent(/creates Kryova's database/);
    expect(screen.queryByText(/Copy diagnostics/)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(70_000);
    });
    expect(await screen.findByText(/Copy diagnostics/)).toBeInTheDocument();
  });

  it("stops asking when the page goes away", async () => {
    const { unmount } = render(<SetupPage />);
    await settle();
    unmount();
    apiCheck.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(apiCheck).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("as the checklist", () => {
  beforeEach(() => open(""));

  it("runs the checks and does not poll or redirect", async () => {
    apiUp = true;
    render(<SetupPage />);
    await settle();

    expect(await screen.findByText("Get started — create an account")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("tells a browser user to start uvicorn", async () => {
    render(<SetupPage />);
    await settle();

    expect(await screen.findByText(/uvicorn app.main:app/)).toBeInTheDocument();
  });

  it("tells an installed-app user the backend did not start, and not to start uvicorn", async () => {
    // Nobody who double-clicked an installer has uvicorn, and the old advice was to run it.
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    render(<SetupPage />);
    await settle();

    expect(await screen.findByText(/backend did not start/)).toBeInTheDocument();
    expect(screen.queryByText(/uvicorn/)).not.toBeInTheDocument();
  });
});
