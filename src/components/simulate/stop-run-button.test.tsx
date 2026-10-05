import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimulationRead } from "@/types/api";

const cancelSimulation = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: { cancelSimulation: (...args: unknown[]) => cancelSimulation(...args) },
}));

import { StopRunButton } from "./stop-run-button";

beforeEach(() => cancelSimulation.mockReset());

function renderButton(status: "queued" | "waiting" | "running") {
  const onStopped = vi.fn();
  render(
    <StopRunButton projectId="proj-1" simulationId="sim-1" status={status} onStopped={onStopped} />,
  );
  return onStopped;
}

describe("StopRunButton", () => {
  it("tells the owner of a waiting run that stopping it costs nothing", () => {
    renderButton("waiting");

    expect(screen.getByText("It has not started, so stopping it costs nothing.")).toBeInTheDocument();
    // The running run's caveat does not apply: nothing has been computed.
    expect(screen.queryByText(/Compute already used is billed/)).not.toBeInTheDocument();
  });

  it("keeps the billing caveat for a running solve only", () => {
    renderButton("running");

    expect(screen.getByText(/Compute already used is billed/)).toBeInTheDocument();
    expect(screen.queryByText(/costs nothing/)).not.toBeInTheDocument();
  });

  it("reports a stopped waiting run as spending nothing, using the run's actual status", async () => {
    const stopped = { id: "sim-1", status: "cancelled" } as SimulationRead;
    cancelSimulation.mockResolvedValue(stopped);
    const onStopped = renderButton("waiting");

    await userEvent.click(screen.getByRole("button", { name: "Stop this run" }));

    await waitFor(() => expect(onStopped).toHaveBeenCalledWith(stopped));
    expect(cancelSimulation).toHaveBeenCalledWith("proj-1", "sim-1");
    expect(
      await screen.findByText("Stopped. It had not started, so nothing was spent."),
    ).toBeInTheDocument();
  });
});
