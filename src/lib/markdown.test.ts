import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown, safeHref, toPlainText } from "@/lib/markdown";

describe("parseInline", () => {
  it("reads bold and inline code", () => {
    expect(parseInline("the **peak** is `142 MPa`")).toEqual([
      { type: "text", value: "the " },
      { type: "strong", children: [{ type: "text", value: "peak" }] },
      { type: "text", value: " is " },
      { type: "code", value: "142 MPa" },
    ]);
  });

  it("leaves snake_case field names alone", () => {
    // The reason `_` emphasis is unsupported: every field name in this product
    // has two underscores in it.
    expect(parseInline("max_von_mises_mpa and element_size_mm")).toEqual([
      { type: "text", value: "max_von_mises_mpa and element_size_mm" },
    ]);
  });

  it("does not interpret markup inside a code span", () => {
    expect(parseInline("`a ** b`")).toEqual([{ type: "code", value: "a ** b" }]);
  });

  it("keeps an unmatched asterisk as literal text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ type: "text", value: "2 * 3 = 6" }]);
  });

  it("parses a link and keeps its label markup", () => {
    expect(parseInline("see [the **run**](/dashboard/projects/1)")).toEqual([
      { type: "text", value: "see " },
      {
        type: "link",
        href: "/dashboard/projects/1",
        children: [
          { type: "text", value: "the " },
          { type: "strong", children: [{ type: "text", value: "run" }] },
        ],
      },
    ]);
  });

  it("degrades an unsafe link to plain text", () => {
    expect(parseInline("[click](javascript:alert)")).toEqual([
      { type: "text", value: "click" },
    ]);
    // The href stops at the first ")", so a nested paren leaks into the text —
    // harmless, and worth pinning so nobody "fixes" it into a link.
    expect(parseInline("[click](javascript:alert(1))")).toEqual([
      { type: "text", value: "click" },
      { type: "text", value: ")" },
    ]);
  });
});

describe("safeHref", () => {
  it("allows http, https, mailto and same-origin paths", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeHref("/dashboard")).toBe("/dashboard");
    expect(safeHref("#results")).toBe("#results");
  });

  it("rejects script-bearing and protocol-relative URLs", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeNull();
    // Browsers strip the tab before resolving, so the check must too.
    expect(safeHref("java\tscript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("   ")).toBeNull();
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs on blank lines", () => {
    const blocks = parseMarkdown("first line\n\nsecond line");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
  });

  it("reads a fenced code block with its language", () => {
    const blocks = parseMarkdown("before\n\n```python\nx = 1\n```\n\nafter");
    expect(blocks[1]).toEqual({ type: "code", language: "python", value: "x = 1" });
    expect(blocks).toHaveLength(3);
  });

  it("renders an unterminated fence as code, because messages arrive mid-stream", () => {
    const blocks = parseMarkdown("```\nhalf a block");
    expect(blocks).toEqual([{ type: "code", language: null, value: "half a block" }]);
  });

  it("groups consecutive bullets into one list", () => {
    const blocks = parseMarkdown("- one\n- two\n- three");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[0].type === "list" && blocks[0].items).toHaveLength(3);
  });

  it("tells an ordered list from a bulleted one", () => {
    const blocks = parseMarkdown("1. first\n2. second");
    expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
  });

  it("reads headings up to level three", () => {
    expect(parseMarkdown("## Findings")).toEqual([
      { type: "heading", level: 2, children: [{ type: "text", value: "Findings" }] },
    ]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });

  it("handles CRLF input", () => {
    expect(parseMarkdown("a\r\n\r\nb")).toHaveLength(2);
  });
});

describe("toPlainText", () => {
  it("strips markup so a live region does not read the asterisks aloud", () => {
    expect(toPlainText("Done. **Pad.1** is `10 mm` thick.")).toBe("Done. Pad.1 is 10 mm thick.");
  });

  it("keeps list items as sentences", () => {
    expect(toPlainText("- four M6 holes\n- material unset")).toBe(
      "four M6 holes. material unset",
    );
  });

  it("returns an empty string for an empty message", () => {
    expect(toPlainText("")).toBe("");
  });
});
