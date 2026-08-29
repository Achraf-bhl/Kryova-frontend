import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimulationRead, SurfaceField } from "@/types/api";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1", simulationId: "sim-1" }),
}));

const readSimulation = vi.fn();
const surfaceFieldBinary = vi.fn();
const surfaceField = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: {
    readSimulation: (...args: unknown[]) => readSimulation(...args),
    surfaceFieldBinary: (...args: unknown[]) => surfaceFieldBinary(...args),
    surfaceField: (...args: unknown[]) => surfaceField(...args),
  },
}));

// These two are exercised by their own component tests; stubbing them here
// keeps this test focused on the results page's own rendering, not theirs.
vi.mock("@/components/result-interpretation", () => ({
  ResultInterpretationPanel: () => null,
}));
vi.mock("@/components/webgl-stress-viewer", () => ({
  WebGLStressViewer: () => null,
}));

import SimulationPage from "./page";

const BASE_SIMULATION: Omit<SimulationRead, "status" | "result" | "error"> = {
  id: "sim-1",
  project_id: "proj-1",
  geometry_version_id: "geo-1",
  solver: "linear-static",
  load_case: { name: "Bracket load" },
  element_size_mm: 5,
  mesh_stats: null,
  fields_media_id: null,
  created_at: "2026-08-27T00:00:00Z",
  started_at: "2026-08-27T00:00:01Z",
  finished_at: "2026-08-27T00:00:02Z",
};

const SURFACE: SurfaceField = {
  node_positions: [[0, 0, 0]],
  triangles: [[0, 0, 0]],
  displacements: [[0, 0, 0]],
  von_mises_mpa: [0],
  max_von_mises_mpa: 0,
  max_displacement_mm: 0,
};

beforeEach(() => {
  readSimulation.mockReset();
  surfaceFieldBinary.mockReset();
  surfaceField.mockReset();
  surfaceFieldBinary.mockResolvedValue(SURFACE);
  surfaceField.mockResolvedValue(SURFACE);
});

describe("SimulationPage results", () => {
  it("renders mass_kg exactly as the API returns it -- never divided by 1000", async () => {
    readSimulation.mockResolvedValue({
      ...BASE_SIMULATION,
      status: "SUCCEEDED",
      error: null,
      result: {
        max_displacement_mm: 0.5,
        max_von_mises_mpa: 150,
        factor_of_safety: 2,
        yields: false,
        mass_kg: 12.34,
        volume_mm3: 1000,
        node_count: 10,
        element_count: 5,
        solve_seconds: 1.2,
        warnings: [],
      },
    });

    render(<SimulationPage />);

    // The shipped bug divided this by 1000 (12.34 -> "0.01 kg"). Assert the
    // exact string, not just that *a* number renders.
    expect(await screen.findByText("12.34 kg")).toBeInTheDocument();
    expect(screen.queryByText("0.01 kg")).not.toBeInTheDocument();
  });

  it("renders max_von_mises_mpa with an explicit MPa unit label", async () => {
    readSimulation.mockResolvedValue({
      ...BASE_SIMULATION,
      status: "SUCCEEDED",
      error: null,
      result: {
        max_displacement_mm: 0.5,
        max_von_mises_mpa: 150,
        factor_of_safety: 2,
        yields: false,
        mass_kg: 1,
        volume_mm3: 1000,
        node_count: 10,
        element_count: 5,
        solve_seconds: 1.2,
        warnings: [],
      },
    });

    render(<SimulationPage />);
    expect(await screen.findByText("150.0 MPa")).toBeInTheDocument();
  });

  it("renders a FAILED simulation's error state instead of a blank page or NaN", async () => {
    readSimulation.mockResolvedValue({
      ...BASE_SIMULATION,
      status: "FAILED",
      error: "Model is under-constrained: fixtures leave 2 rigid-body modes free.",
      result: null,
    });

    render(<SimulationPage />);

    expect(
      await screen.findByText(/Model is under-constrained/),
    ).toBeInTheDocument();
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("FAILED")).toBeInTheDocument());
  });
});
