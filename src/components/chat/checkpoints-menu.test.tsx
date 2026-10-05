import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CheckpointsMenu } from "./checkpoints-menu";

vi.mock("@/components/catia/checkpoint-timeline", () => ({
  CheckpointTimeline: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="timeline">timeline for {conversationId}</div>
  ),
}));

/**
 * What this guards is a disclosure that fetches before anyone asked, or that cannot be
 * dismissed. The timeline is only mounted — and so only loaded — once the button is pressed.
 */
describe("the checkpoints menu", () => {
  it("mounts nothing until it is opened, so nothing is fetched for a menu nobody opened", () => {
    render(<CheckpointsMenu conversationId="c-1" />);

    expect(screen.queryByTestId("timeline")).toBeNull();
    expect(screen.getByRole("button", { name: "Checkpoints" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("opens the timeline for this conversation", () => {
    render(<CheckpointsMenu conversationId="c-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Checkpoints" }));

    expect(screen.getByTestId("timeline").textContent).toBe("timeline for c-1");
    expect(screen.getByRole("button", { name: "Checkpoints" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("closes on a second press and on Escape", () => {
    render(<CheckpointsMenu conversationId="c-1" />);
    const button = screen.getByRole("button", { name: "Checkpoints" });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByTestId("timeline")).toBeNull();

    fireEvent.click(button);
    fireEvent.keyDown(screen.getByTestId("timeline"), { key: "Escape" });
    expect(screen.queryByTestId("timeline")).toBeNull();
  });
});
