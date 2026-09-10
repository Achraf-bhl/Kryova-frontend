import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpecDiff } from "./spec-diff";

/**
 * The claim under test is not "it renders a diff" — it is that the *reached but
 * unedited* half survives all the way to the screen.
 *
 * `app/design/diff.py` computes two different things: `changed_calls`, which is
 * what somebody typed, and `downstream`, which stands on it and may come out a
 * different shape without anybody having touched it. A review that showed only
 * the first is the one that approves a wall thickness and silently moves the
 * bore pattern cut into it.
 */

describe("SpecDiff", () => {
  it("renders nothing when there is no diff in the evidence", () => {
    const { container } = render(<SpecDiff evidence={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says plainly when an edit builds the same part", () => {
    // `plan_changed: false` is a real answer, not an empty state. Editing a
    // feature's rationale note moves both digests and builds a byte-identical
    // part, and telling the reviewer so saves them the review.
    render(<SpecDiff evidence={{ diff: { plan_changed: false } }} />);
    expect(screen.getByText(/builds the same part/i)).toBeInTheDocument();
  });

  it("keeps what was reached apart from what was edited", () => {
    render(
      <SpecDiff
        evidence={{
          diff: {
            plan_changed: true,
            changed_calls: ["wall"],
            downstream: ["bore_pattern"],
          },
        }}
      />,
    );

    expect(screen.getByText(/Rebuilt:/)).toBeInTheDocument();
    expect(screen.getByText("wall")).toBeInTheDocument();
    // The wording is the point: a reviewer must not read this as untouched.
    expect(screen.getByText(/Not edited, but may come out differently:/)).toBeInTheDocument();
    expect(screen.getByText("bore_pattern")).toBeInTheDocument();
  });

  it("marks a value that became an expression differently from one that became a number", () => {
    // `wall_mm: 4 -> 5` and `wall_mm: 4 -> =plate_mm / 2` are different events.
    // The second changed the shape of the design, and is the one that can start
    // moving on its own afterwards.
    const { rerender } = render(
      <SpecDiff
        evidence={{
          diff: {
            plan_changed: true,
            parameters: [{ name: "wall_mm", before: "4", after: "5" }],
          },
        }}
      />,
    );
    expect(screen.getByText("5")).toHaveClass("text-success");

    rerender(
      <SpecDiff
        evidence={{
          diff: {
            plan_changed: true,
            parameters: [{ name: "wall_mm", before: "4", after: "=plate_mm / 2" }],
          },
        }}
      />,
    );
    expect(screen.getByText("=plate_mm / 2")).toHaveClass("text-warning");
  });

  it("distinguishes an added parameter from a removed one", () => {
    render(
      <SpecDiff
        evidence={{
          diff: {
            plan_changed: true,
            parameters: [
              { name: "fillet_mm", before: null, after: "2" },
              { name: "chamfer_mm", before: "1", after: null },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("added as 2")).toBeInTheDocument();
    expect(screen.getByText("removed (was 1)")).toBeInTheDocument();
  });

  it("shows a material change with both sides", () => {
    render(
      <SpecDiff
        evidence={{
          diff: {
            plan_changed: true,
            material: { before: "AISI 316L", after: "Ti-6Al-4V" },
          },
        }}
      />,
    );

    expect(screen.getByText("AISI 316L")).toBeInTheDocument();
    expect(screen.getByText("Ti-6Al-4V")).toBeInTheDocument();
  });
});
