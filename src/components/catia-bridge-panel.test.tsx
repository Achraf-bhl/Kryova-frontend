import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CatiaStatus } from "@/types/catia";

/**
 * ROAD_TO_10 5.7: the bridge panel carries the checkpoint timeline when it is told which
 * conversation it is about, and only where a seat — not the open kernel — is what builds.
 */

const { status } = vi.hoisted(() => ({ status: { current: null as CatiaStatus | null } }));

vi.mock("@/hooks/use-catia-status", () => ({
  useCatiaStatus: () => ({
    state: status.current?.connected ? ("connected" as const) : ("offline" as const),
    status: status.current,
    detail: "detail",
    events: [],
    lastEvent: null,
    refresh: () => {},
  }),
}));

vi.mock("@/components/catia/checkpoint-timeline", () => ({
  CheckpointTimeline: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="timeline">{conversationId}</div>
  ),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { CatiaBridgePanel } = await import("./catia-bridge-panel");

const SEAT: CatiaStatus = {
  connected: true,
  enabled: true,
  backend: "catia",
  paired_devices: 1,
  document: null,
  device_id: "d-1",
  device_name: "Office desktop",
  hostname: "WS-ENG-04",
  catia_version: "V5-R33",
  bridge_version: "1.0.0",
  mock: false,
  capabilities: ["part"],
  ui_language: "fr",
  queue_depth: 0,
  connected_since: "2026-10-05T08:00:00Z",
};

beforeEach(() => {
  status.current = SEAT;
});

describe("the bridge panel's checkpoint timeline", () => {
  it("is shown for the named conversation on a connected seat", () => {
    render(<CatiaBridgePanel conversationId="c-7" />);

    expect(screen.getByTestId("timeline").textContent).toBe("c-7");
  });

  it("is absent when no conversation is named, as on the project page", () => {
    render(<CatiaBridgePanel />);

    expect(screen.queryByTestId("timeline")).toBeNull();
  });

  it("is absent with no workstation connected", () => {
    status.current = { ...SEAT, connected: false } as unknown as CatiaStatus;
    render(<CatiaBridgePanel conversationId="c-7" />);

    expect(screen.queryByTestId("timeline")).toBeNull();
  });

  it("is absent on the open kernel, which has no restore", () => {
    status.current = {
      connected: true,
      enabled: true,
      backend: "occt",
      backend_version: "OCCT 7.8",
      paired_devices: 0,
      operations_implemented: 1,
      operations_declared: 2,
      open_documents: 1,
      document: null,
      detail: "",
    };
    render(<CatiaBridgePanel conversationId="c-7" />);

    expect(screen.queryByTestId("timeline")).toBeNull();
  });
});

describe("the bridge panel states what the seat is", () => {
  it("names the workstation, the CATIA build, the interface language and the idle queue", () => {
    render(<CatiaBridgePanel />);

    const facts = screen.getByText("Workstation").closest("dl");
    expect(facts?.textContent).toContain("Office desktop (WS-ENG-04)");
    expect(facts?.textContent).toContain("V5-R33");
    expect(facts?.textContent).toContain("FR");
    expect(facts?.textContent).toContain("idle");
  });

  it("says a simulated seat is simulated, so nobody mistakes a mock part for a real one", () => {
    status.current = { ...SEAT, mock: true } as CatiaStatus;
    render(<CatiaBridgePanel />);

    expect(screen.getAllByText(/simulated/).length).toBeGreaterThan(0);
  });

  it("says when the interface language was not reported, instead of leaving it blank", () => {
    status.current = { ...SEAT, ui_language: "" } as CatiaStatus;
    render(<CatiaBridgePanel />);

    expect(screen.getByText("not reported")).toBeInTheDocument();
  });

  it("counts a queue that is waiting, in the singular and the plural", () => {
    status.current = { ...SEAT, queue_depth: 1 } as CatiaStatus;
    const { unmount } = render(<CatiaBridgePanel />);
    expect(screen.getByText("1 operation waiting")).toBeInTheDocument();
    unmount();

    status.current = { ...SEAT, queue_depth: 3 } as CatiaStatus;
    render(<CatiaBridgePanel />);
    expect(screen.getByText("3 operations waiting")).toBeInTheDocument();
  });

  it("names the bound document, and says when there is none", () => {
    status.current = {
      ...SEAT,
      document: { doc_name: "Bracket", latest_checkpoint_id: null, bound_at: "2026-10-05T09:00:00Z" },
    } as CatiaStatus;
    const { unmount } = render(<CatiaBridgePanel />);
    expect(screen.getByText("Bracket")).toBeInTheDocument();
    unmount();

    status.current = SEAT;
    render(<CatiaBridgePanel />);
    expect(screen.getByText("none open for this conversation")).toBeInTheDocument();
  });

  it("shows no seat facts with no workstation, where there is no seat to describe", () => {
    status.current = { ...SEAT, connected: false } as unknown as CatiaStatus;
    render(<CatiaBridgePanel />);

    expect(screen.queryByText("Workstation")).toBeNull();
  });

  it("shows none on the open kernel, whose status carries no device fields at all", () => {
    status.current = {
      connected: true,
      enabled: true,
      backend: "occt",
      backend_version: "OCCT 7.8",
      paired_devices: 0,
      operations_implemented: 1,
      operations_declared: 2,
      open_documents: 1,
      document: null,
      detail: "",
    };
    render(<CatiaBridgePanel />);

    expect(screen.queryByText("Workstation")).toBeNull();
    expect(document.body.textContent).not.toContain("undefined");
  });
});
