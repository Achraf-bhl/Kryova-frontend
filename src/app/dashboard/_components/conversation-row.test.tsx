import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ConversationSummary } from "@/types/conversation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { ConversationRow } = await import("./conversation-row");

const summary: ConversationSummary = {
  conversation_id: "c1",
  title: "Bracket study",
  project_id: null,
  created_at: "2026-10-05T00:00:00Z",
  updated_at: "2026-10-05T00:00:00Z",
  message_count: 2,
  has_catia_document: false,
  prompt_tokens: 0,
  completion_tokens: 0,
};

function renderRow(active = false) {
  return render(
    <ul>
      <ConversationRow
        conversation={summary}
        active={active}
        onDeleted={vi.fn()}
        onRenamed={vi.fn()}
        onPinned={vi.fn()}
        onPinSettled={vi.fn()}
      />
    </ul>,
  );
}

describe("ConversationRow keyboard access (8.11)", () => {
  it("reaches delete from the row link with Tab, no hover needed", async () => {
    renderRow();
    await userEvent.tab(); // the link
    await userEvent.tab(); // pin
    await userEvent.tab(); // delete
    expect(screen.getByRole("button", { name: /delete bracket study/i })).toHaveFocus();
  });

  it("moves focus to the confirm button, and back to delete when dismissed", async () => {
    renderRow();
    const del = screen.getByRole("button", { name: /delete bracket study/i });
    del.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /confirm deleting/i })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: /keep this chat/i }));
    expect(screen.getByRole("button", { name: /delete bracket study/i })).toHaveFocus();
  });

  it("renames from the keyboard with F2", async () => {
    renderRow();
    screen.getByRole("link", { name: /bracket study/i }).focus();
    await userEvent.keyboard("{F2}");
    expect(screen.getByRole("textbox", { name: /rename bracket study/i })).toBeInTheDocument();
  });

  it("keeps the actions on the open conversation visible, for touch", () => {
    const { container } = renderRow(true);
    const actions = container.querySelector("span.absolute");
    expect(actions).toHaveClass("flex");
    expect(actions).not.toHaveClass("hidden");
  });

  it("hides them on another row until hover or focus", () => {
    const { container } = renderRow(false);
    expect(container.querySelector("span.absolute")).toHaveClass("hidden");
  });
});
