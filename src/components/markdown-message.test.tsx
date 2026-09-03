import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "./markdown-message";

describe("MarkdownMessage", () => {
  it("renders bold as emphasis rather than showing the asterisks", () => {
    render(<MarkdownMessage content="The **peak** is on the fillet." />);

    expect(screen.getByText("peak").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("renders inline and fenced code", () => {
    const { container } = render(
      <MarkdownMessage content={"Set `element_size_mm`:\n\n```json\n{\"element_size_mm\": 4}\n```"} />,
    );

    expect(screen.getByText("element_size_mm").tagName).toBe("CODE");
    expect(container.querySelector("pre code")).toHaveTextContent('{"element_size_mm": 4}');
  });

  it("renders a bullet list as a list", () => {
    render(<MarkdownMessage content={"- clamp the base\n- load the top face"} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("links safe URLs and strips unsafe ones to plain text", () => {
    render(
      <MarkdownMessage
        content={"[the run](/dashboard/runs) and [not this](javascript:alert)"}
      />,
    );

    expect(screen.getByRole("link", { name: "the run" })).toHaveAttribute(
      "href",
      "/dashboard/runs",
    );
    expect(screen.queryByRole("link", { name: "not this" })).not.toBeInTheDocument();
    expect(screen.getByText(/not this/)).toBeInTheDocument();
  });

  it("never turns model output into markup", () => {
    // The renderer builds React elements from a parsed tree; there is no
    // `dangerouslySetInnerHTML` in the path, so this is text and stays text.
    const { container } = render(
      <MarkdownMessage content={'<img src=x onerror="alert(1)"> <script>alert(2)</script>'} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });

  it("renders nothing for an empty message", () => {
    const { container } = render(<MarkdownMessage content="   " />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a pipe table as a real table, not as pipes in a paragraph", () => {
    // What the assistant actually sends when asked to compare workbenches.
    const { container } = render(
      <MarkdownMessage
        content={
          ["| Step | Workbench |", "| --- | ---: |", "| 1 | Part Design |", "| 2 | GSA |"].join(
            "\n",
          )
        }
      />,
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Workbench" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Part Design" })).toBeInTheDocument();
    // The pipes must not survive as text anywhere.
    expect(container.textContent).not.toContain("|");
  });

  it("gives a wide table its own scroller so the transcript cannot go sideways", () => {
    const { container } = render(
      <MarkdownMessage content={["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n")} />,
    );
    const wrapper = container.querySelector("table")?.parentElement;
    expect(wrapper?.className).toContain("overflow-x-auto");
  });
});
