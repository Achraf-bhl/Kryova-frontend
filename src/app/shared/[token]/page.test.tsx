import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SharedPackage } from "@/types/api";

const readSharedPackage = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: {
    readSharedPackage: (...args: unknown[]) => readSharedPackage(...args),
  },
}));

import SharedPackagePage from "./page";

/**
 * A supplier or customer with no account reads a peak stress here and cannot
 * ask what it means, so the server's not-validated sentence sits above the
 * results table (E20.3). The fixture wording is deliberately not the backend's:
 * the page must render what the API sends.
 */
const STATEMENT = "Not validated. Fixture wording from the API.";

function sharedPackage(overrides: Partial<SharedPackage> = {}): SharedPackage {
  return {
    project_name: "Bracket",
    project_description: null,
    organisation_name: "Acme",
    shared_by: "engineer@example.com",
    label: null,
    note: null,
    expires_at: "2026-10-01T00:00:00Z",
    allow_geometry_download: false,
    geometry: [],
    simulations: [
      {
        analysis: "linear-static",
        status: "succeeded",
        created_at: "2026-09-14T00:00:00Z",
        max_von_mises_mpa: 74.2,
        max_displacement_mm: 0.12,
        mass_kg: 0.41,
        mesh_convergence: "converged",
        solver: "calculix",
      },
    ],
    validation: STATEMENT,
    ...overrides,
  };
}

async function renderPage() {
  const params = Promise.resolve({ token: "tok" });
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <SharedPackagePage params={params} />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  readSharedPackage.mockReset();
});

describe("SharedPackagePage", () => {
  it("states that the results are not validated, above the numbers", async () => {
    readSharedPackage.mockResolvedValue(sharedPackage());
    await renderPage();

    const statement = await screen.findByText(STATEMENT);
    expect(statement).toHaveClass("text-warning");
    const stress = screen.getByText("74.2 MPa");
    expect(statement.compareDocumentPosition(stress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not print the statement over an empty results section", async () => {
    readSharedPackage.mockResolvedValue(sharedPackage({ simulations: [] }));
    await renderPage();

    expect(await screen.findByText("No simulations have been run yet.")).toBeInTheDocument();
    expect(screen.queryByText(STATEMENT)).not.toBeInTheDocument();
  });
});
