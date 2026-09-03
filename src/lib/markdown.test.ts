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

describe("tables", () => {
  // The assistant reaches for a table unprompted whenever it compares things —
  // workbench order, which step constrains which. Before this existed the
  // reader got the pipes as prose, running off the side of the pane.
  const TABLE = [
    "| Step | Workbench | Note |",
    "| --- | --- | --- |",
    "| 1 | Part Design | Pad the base |",
    "| 2 | GSA | Linear static |",
  ].join("\n");

  it("parses a pipe table into header and rows", () => {
    const blocks = parseMarkdown(TABLE);
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    expect(table.header.map((c) => c[0])).toEqual([
      { type: "text", value: "Step" },
      { type: "text", value: "Workbench" },
      { type: "text", value: "Note" },
    ]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1][1][0]).toEqual({ type: "text", value: "GSA" });
  });

  it("reads column alignment from the divider", () => {
    const blocks = parseMarkdown("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
    const table = blocks[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    expect(table.align).toEqual(["left", "center", "right"]);
  });

  it("accepts a table without outer pipes", () => {
    const blocks = parseMarkdown("a | b\n--- | ---\n1 | 2");
    expect(blocks[0].type).toBe("table");
  });

  it("keeps inline formatting inside cells", () => {
    const blocks = parseMarkdown("| x |\n| --- |\n| **bold** |");
    // one column is not a table; it needs at least two to be worth the markup
    expect(blocks[0].type).toBe("paragraph");

    const two = parseMarkdown("| x | y |\n| --- | --- |\n| **bold** | `code` |");
    const table = two[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    expect(table.rows[0][0][0].type).toBe("strong");
    expect(table.rows[0][1][0]).toEqual({ type: "code", value: "code" });
  });

  it("does not treat a lone row of pipes as a table", () => {
    // No divider under it, so it is prose that happens to contain pipes.
    expect(parseMarkdown("the flag is a | b in the config").at(0)?.type).toBe("paragraph");
  });

  it("renders a half-arrived table rather than swallowing it", () => {
    // This parses on every streamed chunk, so a ragged final row is normal.
    const blocks = parseMarkdown("| a | b |\n| --- | --- |\n| 1 |");
    const table = blocks[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    expect(table.rows[0]).toHaveLength(2);
    expect(table.rows[0][1]).toEqual([]);
  });

  it("treats an escaped pipe as a literal, not a column break", () => {
    // The source must carry a real backslash: "\|" in a TS string is just "|".
    const blocks = parseMarkdown(String.raw`| a | b |` + "\n| --- | --- |\n" + String.raw`| x \| y | z |`);
    const table = blocks[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    expect(table.rows[0][0][0]).toEqual({ type: "text", value: "x | y" });
  });

  it("reads a table aloud without saying 'vertical bar'", () => {
    expect(toPlainText(TABLE)).toBe(
      "Step, Workbench, Note. 1, Part Design, Pad the base. 2, GSA, Linear static",
    );
  });
});

describe("thematic breaks", () => {
  it("renders --- as a rule, not as three dashes of prose", () => {
    // The assistant separates sections with these constantly; one answer in the
    // bilingual test carried four.
    const blocks = parseMarkdown(["before", "", "---", "", "after"].join("\n"));

    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "rule", "paragraph"]);
  });

  it("accepts the other rule spellings", () => {
    for (const rule of ["***", "___", "- - -", "----------"]) {
      expect(parseMarkdown(rule).at(0)?.type).toBe("rule");
    }
  });

  it("still reads a table divider as a table, not a rule", () => {
    // `---` is both. The table wins when a header row sits above it.
    const blocks = parseMarkdown(["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n"));
    expect(blocks.map((b) => b.type)).toEqual(["table"]);
  });

  it("does not turn a bullet into a rule", () => {
    expect(parseMarkdown("- item one").at(0)?.type).toBe("list");
  });

  it("is silent when read aloud", () => {
    expect(toPlainText(["one", "", "---", "", "two"].join("\n"))).toBe("one  two");
  });
});
