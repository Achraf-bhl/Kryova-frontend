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
});
