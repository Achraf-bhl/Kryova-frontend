import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResultInterpretation } from "@/types/api";

const interpretSimulation = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: {
    interpretSimulation: (...args: unknown[]) => interpretSimulation(...args),
  },
}));

import { ResultInterpretationPanel } from "./result-interpretation";

/**
 * "Passes" is the word in this product most likely to be read as a prediction
 * of the real part, so the server's not-validated sentence rides beside it
 * (E20.3). The fixture wording is not the backend's: the card must render what
 * the API sends rather than a copy of its own.
 */
const STATEMENT = "Not validated. Fixture wording from the API.";

function interpretation(overrides: Partial<ResultInterpretation> = {}): ResultInterpretation {
  return {
    verdict: "safe",
    headline: "Peak stress is 41% of yield.",
    findings: [{ title: "Peak at the fillet", detail: "Real, not a singularity.", severity: "info" }],
    suggestions: [],
    confidence: "high",
    caveat: "Linear static assumes small deflection.",
    validation: STATEMENT,
    ...overrides,
  } as ResultInterpretation;
}

beforeEach(() => {
  interpretSimulation.mockReset();
});

describe("ResultInterpretationPanel", () => {
  it("puts the validation statement beside a passing verdict", async () => {
    interpretSimulation.mockResolvedValue(interpretation());
    render(<ResultInterpretationPanel projectId="proj-1" simulationId="sim-1" />);

    fireEvent.click(screen.getByRole("button", { name: /explain/i }));

    expect(await screen.findByText("Passes")).toBeInTheDocument();
    const statement = screen.getByText(STATEMENT);
    expect(statement).toHaveClass("text-warning");
    // Above the caveat, not under it: a note under something already believed
    // is a footnote.
    const caveat = screen.getByText("Linear static assumes small deflection.");
    expect(statement.compareDocumentPosition(caveat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
