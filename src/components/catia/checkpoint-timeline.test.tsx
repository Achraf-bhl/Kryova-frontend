import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CheckpointTimeline } from "./checkpoint-timeline";
import type { CatiaCheckpoint } from "@/types/catia";

/**
 * ROAD_TO_10 5.7. What this guards is a destructive button that destroys without being asked,
 * asks for the wrong thing, or reports a rollback that did not happen. A restore discards
 * everything built after a checkpoint, and the approval it needs is the user's click — so the
 * contract is: nothing is minted or run until the *confirm* button, the token is spent in the
 * same breath, and the server's own refusal is what the user reads.
 */

const { listCatiaCheckpoints, approveCatiaRestore, restoreCatiaCheckpoint } = vi.hoisted(() => ({
  listCatiaCheckpoints: vi.fn(),
  approveCatiaRestore: vi.fn(),
  restoreCatiaCheckpoint: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    api: { ...actual.api, listCatiaCheckpoints, approveCatiaRestore, restoreCatiaCheckpoint },
  };
});

const { ApiError } = await import("@/lib/api-client");

const HOLE: CatiaCheckpoint = {
  id: "cp-2",
  label: "before the hole",
  size_bytes: 52_000,
  stored_in_cloud: true,
  created_at: "2026-10-05T09:30:00Z",
};
const PAD: CatiaCheckpoint = {
  id: "cp-1",
  label: "before catia_pad",
  size_bytes: null,
  stored_in_cloud: false,
  created_at: "2026-10-05T09:20:00Z",
};

beforeEach(() => {
  listCatiaCheckpoints.mockReset().mockResolvedValue([HOLE, PAD]);
  approveCatiaRestore.mockReset().mockResolvedValue({ approval_token: "tok", expires_in_seconds: 300 });
  restoreCatiaCheckpoint.mockReset().mockResolvedValue({
    restored_checkpoint_id: "cp-2",
    label: "before the hole",
    message: "The part is back at the checkpoint 'before the hole'.",
  });
});

async function shown() {
  render(<CheckpointTimeline conversationId="c-1" />);
  await screen.findByRole("list", { name: "Checkpoints" });
}

describe("the timeline lists the restore points", () => {
  it("shows each label, and says when the only copy is on the workstation", async () => {
    await shown();

    expect(screen.getByText("before the hole")).toBeTruthy();
    expect(screen.getByText("before catia_pad")).toBeTruthy();
    expect(screen.getAllByText("workstation only")).toHaveLength(1);
  });

  it("asks for the conversation it was given", async () => {
    await shown();
    expect(listCatiaCheckpoints).toHaveBeenCalledWith("c-1");
  });

  it("says plainly that there are none, rather than showing an empty list", async () => {
    listCatiaCheckpoints.mockResolvedValue([]);
    render(<CheckpointTimeline conversationId="c-1" />);

    expect(await screen.findByText(/No checkpoints yet/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Checkpoints" })).toBeNull();
  });

  it("treats a conversation with no document as empty, not as an error", async () => {
    listCatiaCheckpoints.mockRejectedValue(new ApiError(404, "No CATIA document for that conversation"));
    render(<CheckpointTimeline conversationId="c-1" />);

    expect(await screen.findByText(/No checkpoints yet/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a real failure to load in the server's words", async () => {
    listCatiaCheckpoints.mockRejectedValue(new ApiError(500, "The database is unreachable."));
    render(<CheckpointTimeline conversationId="c-1" />);

    expect((await screen.findByRole("alert")).textContent).toContain("The database is unreachable.");
  });
});

describe("a rollback is confirmed before anything is minted", () => {
  it("opens a confirmation that says what will be lost, and calls nothing yet", async () => {
    await shown();

    fireEvent.click(screen.getByRole("button", { name: "Roll back to before the hole" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("before the hole");
    expect(dialog.textContent).toContain("discarded");
    expect(approveCatiaRestore).not.toHaveBeenCalled();
    expect(restoreCatiaCheckpoint).not.toHaveBeenCalled();
  });

  it("cancelling leaves the part alone and mints nothing", async () => {
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to before the hole" }));

    fireEvent.click(screen.getByRole("button", { name: "Keep the part as it is" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(approveCatiaRestore).not.toHaveBeenCalled();
    expect(restoreCatiaCheckpoint).not.toHaveBeenCalled();
  });

  it("confirming approves that checkpoint and spends the token on the same one", async () => {
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to before the hole" }));

    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));

    await waitFor(() => expect(restoreCatiaCheckpoint).toHaveBeenCalledTimes(1));
    expect(approveCatiaRestore).toHaveBeenCalledWith("c-1", "cp-2");
    expect(restoreCatiaCheckpoint).toHaveBeenCalledWith("c-1", "cp-2", "tok");
    // Approved first: a restore must never be sent before its approval exists.
    expect(approveCatiaRestore.mock.invocationCallOrder[0]).toBeLessThan(
      restoreCatiaCheckpoint.mock.invocationCallOrder[0],
    );
  });

  it("reports the server's message, closes the dialog and tells the page", async () => {
    const onRestored = vi.fn();
    render(<CheckpointTimeline conversationId="c-1" onRestored={onRestored} />);
    await screen.findByRole("list", { name: "Checkpoints" });
    fireEvent.click(screen.getByRole("button", { name: "Roll back to before the hole" }));

    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));

    expect((await screen.findByRole("status")).textContent).toContain("The part is back");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(listCatiaCheckpoints).toHaveBeenCalledTimes(2); // refetched after the rollback
  });
});

describe("a rollback that fails says why and claims nothing", () => {
  it("shows an offline workstation's refusal and does not call the page back", async () => {
    restoreCatiaCheckpoint.mockRejectedValue(
      new ApiError(503, "The workstation holding this part is offline. Start it and try again."),
    );
    const onRestored = vi.fn();
    render(<CheckpointTimeline conversationId="c-1" onRestored={onRestored} />);
    await screen.findByRole("list", { name: "Checkpoints" });
    fireEvent.click(screen.getByRole("button", { name: "Roll back to before the hole" }));

    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));

    expect((await screen.findByRole("alert")).textContent).toContain("is offline");
    expect(screen.queryByRole("status")).toBeNull();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("does not run the restore when the approval itself was refused", async () => {
    approveCatiaRestore.mockRejectedValue(new ApiError(404, "Checkpoint not found"));
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to before the hole" }));

    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Checkpoint not found");
    expect(restoreCatiaCheckpoint).not.toHaveBeenCalled();
  });
});
