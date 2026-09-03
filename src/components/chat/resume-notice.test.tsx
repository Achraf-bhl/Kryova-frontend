import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResumeNotice } from "./resume-notice";

describe("ResumeNotice", () => {
  it("renders nothing when there is nothing to say", () => {
    // The common case by design: a conversation continued in one sitting with
    // nothing broken gets no banner at all.
    const { container } = render(<ResumeNotice notice={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the headline on its own when nothing was left broken", () => {
    render(<ResumeNotice notice={{ headline: "Picked up 2 days later", unfinished: [] }} />);

    expect(screen.getByText("Picked up 2 days later")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("names each loose end with what CATIA said about it", () => {
    // The reason this component exists. A feature that failed to build leaves
    // no trace in the part, so the error text is the only evidence there is.
    render(
      <ResumeNotice
        notice={{
          headline: "Picked up 6 hours later — 30 CATIA operations so far",
          unfinished: [
            {
              tool: "catia_hole",
              label: "CATIA: hole",
              error: "The hole breaks through the wall",
              attempts: 3,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("One step never completed")).toBeInTheDocument();
    expect(screen.getByText("CATIA: hole")).toBeInTheDocument();
    expect(screen.getByText(/breaks through the wall/)).toBeInTheDocument();
    // The attempt count is worth showing: three failures is a different problem
    // from one, and it says the agent already tried working around it.
    expect(screen.getByText(/3 attempts/)).toBeInTheDocument();
  });

  it("does not claim repeated attempts for a single failure", () => {
    render(
      <ResumeNotice
        notice={{
          headline: "31 CATIA operations so far",
          unfinished: [
            { tool: "catia_pad", label: "CATIA: pad", error: "no profile", attempts: 1 },
          ],
        }}
      />,
    );

    expect(screen.queryByText(/attempts/)).not.toBeInTheDocument();
  });

  it("counts the loose ends when there is more than one", () => {
    render(
      <ResumeNotice
        notice={{
          headline: "Picked up 1 day later — 40 CATIA operations so far",
          unfinished: [
            { tool: "catia_pad", label: "CATIA: pad", error: "no profile", attempts: 1 },
            { tool: "catia_shell", label: "CATIA: shell", error: "wall too thin", attempts: 1 },
          ],
        }}
      />,
    );

    expect(screen.getByText("2 steps never completed")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
