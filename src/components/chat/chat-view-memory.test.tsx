import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectMemoryRead } from "@/types/api";

/**
 * The assistant's project-fact suggestions inside the real ChatView (ROAD_TO_10 2.7).
 * `memory-proposals.test.tsx` covers the component; this covers that the chat *hosts*
 * it — for a conversation that has a project, and not otherwise — which a component
 * test cannot see and which is the half that decides whether a user ever meets it.
 */

const { listProjectMemory } = vi.hoisted(() => ({ listProjectMemory: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, api: { ...actual.api, listProjectMemory } };
});

vi.mock("@/hooks/use-catia-status", () => ({
  useCatiaStatus: () => ({
    state: "offline" as const,
    status: null,
    detail: "",
    events: [],
    lastEvent: null,
    refresh: () => {},
  }),
}));

const { ChatView } = await import("./chat-view");

const user = { fullName: "Aziz Bahloul", email: "aziz@example.com" };

function proposal(): ProjectMemoryRead {
  return {
    id: "m-1",
    text: "Fasteners are ISO 4762 A2-70.",
    state: "proposed",
    author: "agent",
    author_id: null,
    conversation_id: "conv-1",
    created_at: "2026-10-05T09:00:00Z",
    confirmed_at: null,
  };
}

beforeEach(() => {
  listProjectMemory.mockReset();
  listProjectMemory.mockResolvedValue({
    items: [proposal()],
    total: 1,
    page: 1,
    page_size: 100,
    limit: 40,
  });
});

describe("ChatView and the project's suggested facts", () => {
  it("shows what the assistant suggested remembering, for a conversation on a project", async () => {
    render(
      <ChatView
        {...user}
        conversationId="conv-1"
        title="Frame"
        projectId="p-1"
        initialTurns={[{ id: "m-0", sequence: 0, role: "user", content: "hi" }]}
      />,
    );

    expect(await screen.findByText("Fasteners are ISO 4762 A2-70.")).toBeInTheDocument();
    expect(listProjectMemory).toHaveBeenCalledWith("p-1");
  });

  it("asks nothing and shows nothing when the conversation has no project", async () => {
    render(
      <ChatView
        {...user}
        conversationId="conv-1"
        title="Loose"
        initialTurns={[{ id: "m-0", sequence: 0, role: "user", content: "hi" }]}
      />,
    );

    // Let any effect that was going to fire fire.
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    expect(listProjectMemory).not.toHaveBeenCalled();
    expect(screen.queryByText("Fasteners are ISO 4762 A2-70.")).not.toBeInTheDocument();
  });
});
