import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Turn } from "@/lib/conversation-transcript";
import type { CatiaStatus } from "@/types/catia";

/**
 * ROAD_TO_10 5.7: the way back to a checkpoint is in the conversation's header, and only
 * where a rollback can happen. A button that cannot work is worse than none — it is the thing
 * a person presses in a hurry, right after the assistant did something they did not want.
 */

const { status } = vi.hoisted(() => ({ status: { current: null as CatiaStatus | null } }));

vi.mock("@/hooks/use-catia-status", () => ({
  useCatiaStatus: () => ({
    state: "connected" as const,
    status: status.current,
    detail: "",
    events: [],
    lastEvent: null,
    refresh: () => {},
  }),
}));

vi.mock("@/components/chat/checkpoints-menu", () => ({
  CheckpointsMenu: ({ conversationId }: { conversationId: string }) => (
    <button type="button">Checkpoints for {conversationId}</button>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/agent-stream", () => ({ streamAgent: vi.fn(async () => {}) }));

const { ChatView } = await import("./chat-view");

const user = { fullName: "Aziz Bahloul", email: "aziz@example.com" };
const TURNS: Turn[] = [
  { id: "m-0", sequence: 0, role: "user", content: "build a plate" },
  { id: "m-1", sequence: 1, role: "assistant", content: "The plate is built." },
];

const document = { doc_name: "Plate", latest_checkpoint_id: null, bound_at: "2026-10-05T09:00:00Z" };

const SEAT: CatiaStatus = {
  connected: true,
  enabled: true,
  backend: "catia",
  paired_devices: 1,
  document,
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

function renderChat() {
  return render(<ChatView {...user} conversationId="conv-1" title="Plate" initialTurns={TURNS} />);
}

beforeEach(() => {
  status.current = null;
});

describe("the checkpoints control", () => {
  it("is offered on a connected seat that holds this conversation's document", () => {
    status.current = SEAT;
    renderChat();

    expect(screen.getByRole("button", { name: "Checkpoints for conv-1" })).toBeInTheDocument();
  });

  it("is not offered with no workstation connected, where a rollback could not run", () => {
    status.current = {
      connected: false,
      enabled: true,
      backend: "catia",
      paired_devices: 1,
      document,
      detail: "Office desktop is offline.",
    };
    renderChat();

    expect(screen.queryByRole("button", { name: /Checkpoints for/ })).not.toBeInTheDocument();
  });

  it("is not offered on the open kernel, which has no catia_restore", () => {
    status.current = {
      connected: true,
      enabled: true,
      backend: "occt",
      backend_version: "OCCT 7.8",
      paired_devices: 0,
      operations_implemented: 100,
      operations_declared: 201,
      open_documents: 1,
      document: { doc_name: "Plate", evicted: false },
      detail: "",
    };
    renderChat();

    expect(screen.queryByRole("button", { name: /Checkpoints for/ })).not.toBeInTheDocument();
  });

  it("is not offered before the conversation has a document to roll back", () => {
    status.current = { ...SEAT, document: null };
    renderChat();

    expect(screen.queryByRole("button", { name: /Checkpoints for/ })).not.toBeInTheDocument();
  });
});
