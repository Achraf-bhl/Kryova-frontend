import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SimulationRead } from "@/types/api";

import { ConvergenceBadge, ProvenanceNote, VerdictBadge, VerificationSummary } from "./verification-panel";

/**
 * One claim, tested from several directions: **unmeasured is never green.**
 *
 * That is Decision 3 rendered — "an unmeasured claim is never a pass; an
 * unconverged number is worse than no number". A dashboard that painted an
 * unmeasured assertion the same colour as a passing one would undo, at the last
 * inch, the entire apparatus that keeps `UNMEASURED` a first-class outcome in
 * `app/design/assertions.py` and `app/requirements/`.
 */

function simulation(overrides: Partial<SimulationRead> = {}): SimulationRead {
  return {
    id: "sim-1",
    project_id: "proj-1",
    geometry_version_id: "geo-abcdef123456",
    status: "succeeded",
    solver: "calculix",
    load_case: {},
    thermal_case: null,
    element_size_mm: 4,
    element_order: 1,
    analysis: "solid",
    grids: 1,
    thickness_mm: null,
    mesh_stats: null,
    result: null,
    error: null,
    created_at: "2026-09-10T09:00:00Z",
    started_at: null,
    finished_at: null,
    ...overrides,
  } as SimulationRead;
}

describe("VerdictBadge", () => {
  it("gives a met assertion green and a violated one red", () => {
    const { rerender } = render(<VerdictBadge verdict="passed" />);
    expect(screen.getByText("met")).toHaveClass("text-success");

    rerender(<VerdictBadge verdict="failed" />);
    expect(screen.getByText("violated")).toHaveClass("text-danger");
  });

  it("gives an unmeasured assertion amber, and never green", () => {
    render(<VerdictBadge verdict="unmeasured" />);
    const badge = screen.getByText("not measured");

    expect(badge).toHaveClass("text-warning");
    expect(badge).not.toHaveClass("text-success");
  });
});

describe("ConvergenceBadge", () => {
  it("says there is no record rather than implying one", () => {
    render(<ConvergenceBadge simulation={simulation()} />);
    expect(screen.getByText("no convergence record")).toBeInTheDocument();
  });

  it("earns green only when a study actually converged", () => {
    render(
      <ConvergenceBadge
        simulation={simulation({ result: { mesh_convergence: "converged" } as never })}
      />,
    );
    expect(screen.getByText("mesh converged")).toHaveClass("text-success");
  });

  it("treats a single grid as unverified, however fine the mesh was", () => {
    // A single solve holds no evidence about its own discretisation error.
    // Measured at gate G1: a factor of safety of 1303 reported off one
    // 411-element tet4 mesh.
    render(
      <ConvergenceBadge
        simulation={simulation({
          element_size_mm: 0.2,
          result: { mesh_convergence: "single-grid" } as never,
        })}
      />,
    );
    const badge = screen.getByText("one mesh — unverified");
    expect(badge).toHaveClass("text-warning");
    expect(badge).not.toHaveClass("text-success");
  });

  it("reads the verdict out of an object as well as a bare string", () => {
    render(
      <ConvergenceBadge
        simulation={simulation({ result: { mesh_convergence: { verdict: "converged" } } as never })}
      />,
    );
    expect(screen.getByText("mesh converged")).toBeInTheDocument();
  });
});

describe("ProvenanceNote", () => {
  it("puts an approximation beside the number rather than in a tooltip", () => {
    render(<ProvenanceNote basis="approximated" how="summed from the calls we drove" />);
    const note = screen.getByText(/approximated — summed from the calls we drove/);
    expect(note).toHaveClass("text-warning");
  });

  it("does not dress an unavailable value up as a measured one", () => {
    render(<ProvenanceNote basis="unavailable" how="no seat was connected" />);
    expect(screen.getByText(/not available/)).toHaveClass("text-warning");
  });

  it("leaves a measured value quiet", () => {
    render(<ProvenanceNote basis="measured" />);
    expect(screen.getByText("measured")).toHaveClass("text-muted");
  });
});

describe("VerificationSummary", () => {
  it("says there is nothing to verify rather than nothing at all", () => {
    render(<VerificationSummary simulation={simulation()} />);
    expect(screen.getByText(/no result to verify yet/i)).toBeInTheDocument();
  });

  it("names what the number is bound to", () => {
    // A result bound to nothing is a result nobody can reproduce, which
    // Decision 3 treats as no result.
    render(<VerificationSummary simulation={simulation({ result: {} as never })} />);

    expect(screen.getByText("calculix")).toBeInTheDocument();
    expect(screen.getByText("geo-abcd")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("says the solver version is unrecorded rather than omitting the question", () => {
    render(<VerificationSummary simulation={simulation({ result: {} as never })} />);
    expect(screen.getByText(/version not recorded/)).toBeInTheDocument();
  });

  it("warns on one grid and tells the reader what to do about it", () => {
    render(<VerificationSummary simulation={simulation({ grids: 1, result: {} as never })} />);
    expect(screen.getByText(/discretisation error assessed rather than assumed/)).toBeInTheDocument();
    expect(screen.getByText("grids: 3")).toBeInTheDocument();
  });

  it("does not warn when several grids were assessed", () => {
    render(<VerificationSummary simulation={simulation({ grids: 3, result: {} as never })} />);
    expect(screen.getByText(/Assessed across 3 grids/)).toBeInTheDocument();
    expect(screen.queryByText(/rather than assumed/)).not.toBeInTheDocument();
  });
});
