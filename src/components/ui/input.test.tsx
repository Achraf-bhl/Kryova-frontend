import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { Input } from "./input";

describe("Input", () => {
  it("merges a passed className instead of replacing its own styling", () => {
    // This is the regression. `{...props}` was spread after `className`, so a
    // caller passing one silently overwrote the whole string: the field kept
    // its label and lost its border, height, focus ring and placeholder
    // colour, with nothing to say why.
    render(<Input id="x" label="Width" className="w-24" />);

    const field = screen.getByLabelText("Width");
    expect(field).toHaveClass("w-24");
    expect(field).toHaveClass("h-10");
    expect(field).toHaveClass("border-border");
  });

  it("keeps its styling when no className is passed", () => {
    render(<Input id="y" label="Plain" />);
    expect(screen.getByLabelText("Plain")).toHaveClass("h-10");
  });

  it("still forwards ordinary input props", () => {
    render(<Input id="z" label="Count" type="number" min={0} max={10} />);
    const field = screen.getByLabelText("Count");
    expect(field).toHaveAttribute("type", "number");
    expect(field).toHaveAttribute("min", "0");
  });
});

describe("Button and Input agree about className", () => {
  it("both merge rather than one replacing", () => {
    // Two primitives in one barrel disagreeing about this is how a page ends
    // up subtly wrong in a way nobody can attribute.
    render(
      <>
        <Button className="w-24">Go</Button>
        <Input id="q" label="Q" className="w-24" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("w-24", "h-10");
    expect(screen.getByLabelText("Q")).toHaveClass("w-24", "h-10");
  });
});
