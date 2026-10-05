import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckList, MachineChecks, ServerHealth } from "@/components/onboarding/machine-checks";
import { api } from "@/lib/api-client";

afterEach(() => vi.restoreAllMocks());

describe("CheckList", () => {
  it("says each state in words as well as colour", () => {
    render(
      <CheckList
        rows={[
          { id: "a", label: "Database", state: "ok", detail: "stored here" },
          { id: "b", label: "Files", state: "problem", detail: "disk full", fix: "free space" },
        ]}
      />,
    );
    expect(screen.getByText("— ready")).toBeInTheDocument();
    expect(screen.getByText("— needs attention")).toBeInTheDocument();
    expect(screen.getByText("free space")).toBeInTheDocument();
  });
});

describe("MachineChecks", () => {
  it("builds its rows from the two status routes and offers a first prompt when both are ready", async () => {
    vi.spyOn(api, "aiStatus").mockResolvedValue({
      enabled: true,
      provider: "deepseek",
      model: "deepseek-flash",
      detail: null,
    });
    vi.spyOn(api, "catiaStatus").mockResolvedValue({
      connected: true,
      enabled: true,
      backend: "occt",
      backend_version: "7.8",
      paired_devices: 0,
      operations_implemented: null,
      operations_declared: null,
      open_documents: 0,
      document: null,
      detail: "",
    });
    render(<MachineChecks />);
    await waitFor(() => expect(screen.getByTestId("machine-checks")).toBeInTheDocument());
    expect(screen.getByText(/A good first message/)).toBeInTheDocument();
  });

  it("shows unknown rows and no first prompt when the routes cannot be read", async () => {
    vi.spyOn(api, "aiStatus").mockRejectedValue(new Error("down"));
    vi.spyOn(api, "catiaStatus").mockRejectedValue(new Error("down"));
    render(<MachineChecks />);
    await waitFor(() => expect(screen.getByTestId("machine-checks")).toBeInTheDocument());
    expect(screen.getAllByText("— could not be read")).toHaveLength(2);
    expect(screen.queryByText(/A good first message/)).toBeNull();
  });
});

describe("ServerHealth", () => {
  it("reads the failing check out of a 503 body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ status: "degraded", checks: { database: "connection refused", media_store: "ok" } }),
      }),
    );
    render(<ServerHealth />);
    await waitFor(() => expect(screen.getByText("connection refused")).toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
