import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  BranchButton,
  BranchNotice,
  RewindActions,
  RewindRefusal,
} from "@/components/chat/message-actions";

describe("RewindActions", () => {
  it("retries and edits through two separate buttons", async () => {
    const onRetry = vi.fn();
    const onEdit = vi.fn();
    render(<RewindActions disabled={false} onRetry={onRetry} onEdit={onEdit} />);

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", async () => {
    const onRetry = vi.fn();
    render(<RewindActions disabled onRetry={onRetry} onEdit={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe("BranchButton", () => {
  it("names what it does for a screen reader, not just 'Branch'", async () => {
    const onBranch = vi.fn();
    render(<BranchButton disabled={false} onBranch={onBranch} />);

    await userEvent.click(
      screen.getByRole("button", { name: /branch a new conversation from this answer/i }),
    );
    expect(onBranch).toHaveBeenCalledTimes(1);
  });
});

describe("RewindRefusal", () => {
  const reason = "That turn changed things (catia_pad).";

  it("says why, in the server's words", () => {
    render(<RewindRefusal reason={reason} canBranch={false} onBranch={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(reason);
  });

  it("offers the branch only when there is an earlier answer to branch from", async () => {
    const onBranch = vi.fn();
    const { rerender } = render(
      <RewindRefusal reason={reason} canBranch onBranch={onBranch} onDismiss={() => {}} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /branch from the answer before it/i }));
    expect(onBranch).toHaveBeenCalledTimes(1);

    rerender(
      <RewindRefusal reason={reason} canBranch={false} onBranch={onBranch} onDismiss={() => {}} />,
    );
    expect(
      screen.queryByRole("button", { name: /branch from the answer before it/i }),
    ).not.toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    const onDismiss = vi.fn();
    render(<RewindRefusal reason={reason} canBranch={false} onBranch={() => {}} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("BranchNotice", () => {
  const from = { conversation_id: "src-1", title: "Plate study", at_sequence: 3 };

  it("says nothing in a conversation that is not a branch", () => {
    const { container } = render(<BranchNotice from={null} hasDocument={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links the original and says the CATIA part did not come with it", () => {
    render(<BranchNotice from={from} hasDocument={false} />);

    expect(screen.getByRole("link", { name: "Plate study" })).toHaveAttribute(
      "href",
      "/dashboard/c/src-1",
    );
    expect(screen.getByText(/the catia part was not copied/i)).toBeInTheDocument();
  });

  it("drops the caveat once the branch has a document of its own", () => {
    render(<BranchNotice from={from} hasDocument />);

    expect(screen.getByRole("link", { name: "Plate study" })).toBeInTheDocument();
    expect(screen.queryByText(/not copied/i)).not.toBeInTheDocument();
  });
});
