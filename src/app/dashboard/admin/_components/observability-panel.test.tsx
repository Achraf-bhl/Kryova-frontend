import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Observability } from "@/types/api";

import { ObservabilityPanel } from "./observability-panel";

function data(overrides: Partial<Observability> = {}): Observability {
  return {
    window_hours: 24,
    spans: {
      scope: "This worker process only, since it started, newest 512 occurrences per site.",
      sites: [
        {
          name: "mesh.gmsh.session",
          seen: 1200,
          failures: 3,
          window_size: 512,
          median_seconds: 4.2,
          p95_seconds: 31,
          max_seconds: 60,
          p95_is_the_maximum: false,
        },
        {
          name: "kernel.rebuild",
          seen: 4,
          failures: 0,
          window_size: 4,
          median_seconds: 0.2,
          p95_seconds: 0.9,
          max_seconds: 0.9,
          p95_is_the_maximum: true,
        },
      ],
    },
    turns: {
      turns: 10,
      priced_turns: 8,
      unpriced_turns: 2,
      total_micro_usd: 1_234_567,
      mean_micro_usd: 154_320,
      max_micro_usd: 500_000,
      median_wall_ms: 240_000,
      p95_wall_ms: 400_000,
      by_stop_reason: { finished: 7, step_budget: 3 },
    },
    ai_cache: {
      turns: 0,
      prompt_tokens: 0,
      cached_prompt_tokens: 0,
      hit_rate: null,
      recent_turns: 0,
      recent_hit_rate: null,
      reported: false,
      alert: null,
    },
    queue_depth: { waiting: 0, running: 2, succeeded: 0 },
    bridge: {
      operations: [
        {
          tool: "catia_fillet",
          count: 50,
          failures: 5,
          median_ms: 2000,
          p95_ms: 9000,
          max_ms: 12000,
          p95_is_the_maximum: false,
        },
      ],
      truncated: false,
    },
    ...overrides,
  };
}

describe("ObservabilityPanel", () => {
  it("prints the server's sentence about whose view the span table is", () => {
    render(<ObservabilityPanel data={data()} />);
    expect(screen.getByText(/This worker process only/)).toBeInTheDocument();
  });

  it("lists the slowest tail first and labels a small sample's tail as the maximum", () => {
    render(<ObservabilityPanel data={data()} />);
    const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    const mesh = rows.findIndex((text) => text.includes("mesh.gmsh.session"));
    const kernel = rows.findIndex((text) => text.includes("kernel.rebuild"));
    expect(mesh).toBeGreaterThan(-1);
    expect(mesh).toBeLessThan(kernel);
    expect(rows[kernel]).toMatch(/max \(too few for p95\)/);
    expect(rows[mesh]).toMatch(/p95/);
    expect(rows[mesh]).toMatch(/3 of 1,200 failed/);
  });

  it("says unpriced turns are outside the total, and shows the money exactly", () => {
    render(<ObservabilityPanel data={data()} />);
    expect(screen.getByText("$1.23")).toBeInTheDocument();
    expect(screen.getByText(/2 turns have no configured price/)).toBeInTheDocument();
  });

  it("lists only the queue states that have something in them", () => {
    render(<ObservabilityPanel data={data()} />);
    expect(screen.getByText("running 2")).toBeInTheDocument();
    expect(screen.queryByText(/waiting 0/)).not.toBeInTheDocument();
  });

  it("names the slowest bridge operation with its failures", () => {
    render(<ObservabilityPanel data={data()} />);
    const row = screen.getByText("catia_fillet").closest("tr") as HTMLElement;
    expect(within(row).getByText("5 of 50 failed")).toBeInTheDocument();
    expect(within(row).getByText("9.0 s")).toBeInTheDocument();
  });

  it("says plainly when there is nothing to show instead of drawing empty tables", () => {
    render(
      <ObservabilityPanel
        data={data({
          spans: { scope: "scope", sites: [] },
          turns: { ...data().turns, turns: 0 },
          queue_depth: { waiting: 0 },
          bridge: { operations: [], truncated: false },
        })}
      />,
    );
    expect(screen.getByText("Nothing timed on this worker yet.")).toBeInTheDocument();
    expect(screen.getByText("No agent turns in this window.")).toBeInTheDocument();
    expect(screen.getByText("No runs are queued or running.")).toBeInTheDocument();
    expect(screen.getByText("No CATIA operations in this window.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says when the bridge figures cover only the newest operations", () => {
    const base = data();
    render(
      <ObservabilityPanel data={data({ bridge: { ...base.bridge, truncated: true } })} />,
    );
    expect(screen.getByText(/figures are for the newest/)).toBeInTheDocument();
  });
});
