import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Turn } from "@/lib/conversation-transcript";

vi.mock("@/hooks/use-catia-status", () => ({
  useCatiaStatus: () => ({
    state: "offline" as const,
    status: null,
    detail: "No workstation has been paired with this account yet.",
    events: [],
    lastEvent: null,
    refresh: () => {},
  }),
}));

const { ChatView } = await import("./chat-view");

const user = { fullName: "Aziz Bahloul", email: "aziz@example.com" };

describe("ChatView", () => {
  it("greets by first name and offers the three engineering openers", () => {
    render(<ChatView {...user} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/, Aziz$/);
    expect(screen.getByText("What are we building?")).toBeInTheDocument();
    expect(
      screen.getByText("Model a mounting bracket, 120 × 80 × 10 mm, with four M6 holes"),
    ).toBeInTheDocument();
    expect(screen.getByText("Clamp the base, hang 40 kg off the top face, and run it")).toBeInTheDocument();
    expect(
      screen.getByText("Where is this part going to fail, and what should I thicken?"),
    ).toBeInTheDocument();
  });

  it("falls back to the email handle when there is no name on the account", () => {
    render(<ChatView fullName={null} email="aziz@example.com" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/, aziz$/);
  });

  it("loads a suggestion into the composer instead of sending it blind", async () => {
    render(<ChatView {...user} />);

    await userEvent.click(
      screen.getByText("Clamp the base, hang 40 kg off the top face, and run it"),
    );

    expect(screen.getByRole("textbox", { name: /message the kryova agent/i })).toHaveValue(
      "Clamp the base, hang 40 kg off the top face, and run it",
    );
  });

  it("rehydrates a stored transcript, so a refresh does not lose the conversation", () => {
    const turns: Turn[] = [
      { id: "m-1", role: "user", content: "Model a bracket 120 x 80 x 10" },
      {
        id: "m-2",
        role: "assistant",
        content: "Done — **Pad.1** created.",
        steps: [
          {
            id: "call_1",
            tool: "catia_pad",
            label: "Pad",
            arguments: { length_mm: 10 },
            status: "ok",
            summary: "Pad.1",
          },
        ],
      },
    ];

    render(
      <ChatView
        {...user}
        conversationId="conv-1"
        title="Bracket assembly"
        initialTurns={turns}
        boundDocument="Bracket.CATPart"
      />,
    );

    expect(screen.getByText("Model a bracket 120 x 80 x 10")).toBeInTheDocument();
    // The answer is rendered as markdown, so the bold survives as emphasis.
    expect(screen.getByText("Pad.1", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Pad")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bracket assembly" })).toBeInTheDocument();
    // The greeting belongs to the empty state only.
    expect(screen.queryByText("What are we building?")).not.toBeInTheDocument();
  });

  it("shows CATIA state next to the composer, with the reason attached", () => {
    render(<ChatView {...user} />);

    const chip = screen.getByRole("link", { name: /CATIA/ });
    expect(chip).toHaveAttribute("href", "/dashboard/settings#catia");
    expect(chip).toHaveAttribute(
      "title",
      "No workstation has been paired with this account yet.",
    );
  });
});
