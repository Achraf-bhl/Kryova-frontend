/**
 * A small Markdown parser for the subset the agent actually emits.
 *
 * Two constraints shaped this. First, model output is untrusted text, so the
 * pipeline must never reach HTML: this produces a node tree that
 * `components/markdown-message.tsx` renders as React elements, and there is no
 * `dangerouslySetInnerHTML` anywhere in it. Second, the repo ships three
 * dependencies on purpose; a full CommonMark implementation is ~40 kB of client
 * JS to render bold, code and bullets.
 *
 * Deliberately NOT supported: `_underscore emphasis_`. This is an FEA product
 * whose vocabulary is snake_case — `max_von_mises_mpa`, `element_size_mm`,
 * `factor_of_safety`. Every one of those contains a pair of underscores, and a
 * CommonMark-correct parser italicises the middle of them. Asterisks only.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] };

export type TableAlign = "left" | "right" | "center";

export type MarkdownBlock =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: "code"; language: string | null; value: string }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "rule" }
  | {
      type: "table";
      align: TableAlign[];
      header: InlineNode[][];
      rows: InlineNode[][][];
    };

/**
 * Accept only schemes that cannot execute.
 *
 * `javascript:`, `data:` and `vbscript:` are the whole attack surface of a
 * model-authored link. Anything unrecognised returns null and the caller
 * renders the link's text as plain text, so a suspicious URL degrades to
 * something inert rather than disappearing without trace.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "") return null;
  // Same-document and same-origin targets.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  // Browsers strip whitespace and control characters out of a URL before
  // resolving it, so `java\tscript:alert(1)` navigates while passing a naive
  // prefix check. Compare against the same normalisation the browser applies.
  let normalised = "";
  for (const char of trimmed.toLowerCase()) {
    const code = char.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) normalised += char;
  }

  if (normalised.startsWith("http://") || normalised.startsWith("https://")) return trimmed;
  if (normalised.startsWith("mailto:")) return trimmed;
  return null;
}

interface LinkMatch {
  label: string;
  href: string;
  end: number;
}

/** `[label](href)` starting at `start`, or null. Nested brackets are ignored. */
function matchLink(text: string, start: number): LinkMatch | null {
  const labelEnd = text.indexOf("]", start + 1);
  if (labelEnd < 0 || text[labelEnd + 1] !== "(") return null;
  const hrefEnd = text.indexOf(")", labelEnd + 2);
  if (hrefEnd < 0) return null;
  return {
    label: text.slice(start + 1, labelEnd),
    href: text.slice(labelEnd + 2, hrefEnd),
    end: hrefEnd + 1,
  };
}

/** Parse one run of inline markup. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let i = 0;

  const flush = (): void => {
    if (buffer !== "") {
      nodes.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    const char = text[i];

    // Code spans win over everything: their contents are literal, which is the
    // point of writing `**` or `*` inside one.
    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: "code", value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (char === "[") {
      const link = matchLink(text, i);
      if (link) {
        const href = safeHref(link.href);
        flush();
        if (href) {
          nodes.push({ type: "link", href, children: parseInline(link.label) });
        } else {
          // Unsafe scheme: keep the words, drop the navigation.
          nodes.push(...parseInline(link.label));
        }
        i = link.end;
        continue;
      }
    }

    if (char === "*" && text[i + 1] === "*") {
      const close = text.indexOf("**", i + 2);
      if (close > i + 2) {
        flush();
        nodes.push({ type: "strong", children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (char === "*") {
      const close = text.indexOf("*", i + 1);
      if (close > i + 1) {
        flush();
        nodes.push({ type: "em", children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return nodes;
}

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text" || node.type === "code" ? node.value : inlineText(node.children),
    )
    .join("");
}

/**
 * The message as prose, for a screen reader.
 *
 * A live region announcing the raw source reads "asterisk asterisk Pad dot one
 * asterisk asterisk" — the markup is meaningless out loud, so the announcement
 * gets the text and the visible transcript keeps the formatting.
 */
export function toPlainText(source: string): string {
  return parseMarkdown(source)
    .map((block) => {
      switch (block.type) {
        case "code":
          return block.value;
        case "list":
          return block.items.map(inlineText).join(". ");
        case "table":
          // Read out row by row, cells separated by commas. A screen reader
          // announcing the pipes would say "vertical bar" at every column.
          return [block.header, ...block.rows]
            .map((row) => row.map(inlineText).join(", "))
            .join(". ");
        case "rule":
          return "";
        default:
          return inlineText(block.children);
      }
    })
    .join(" ")
    .trim();
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const FENCE = /^\s{0,3}```(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/**
 * The `|---|:--:|---:|` line that turns the row above it into a table header.
 *
 * Tables are not decoration here. Ask the assistant to compare workbenches, or
 * which step constrains which, and it answers with one unprompted — and without
 * this the reader got `| 3 | Part Design | Apply Draft Angle (Dépouille) |` as a
 * paragraph, pipes and all, running off the right of the pane.
 */
const TABLE_DIVIDER = /^\s{0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/**
 * Split one table row on its pipes.
 *
 * The outer pipes are optional in GFM — `a | b` is as valid as `| a | b |` — so
 * they are trimmed before splitting rather than relied on. An escaped `\|` is a
 * literal pipe inside a cell and must not split it.
 */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\" && text[i + 1] === "|") {
      cell += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function rowAlignment(divider: string): TableAlign[] {
  return splitRow(divider).map((spec) => {
    const left = spec.startsWith(":");
    const right = spec.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

/**
 * Parse a message into blocks.
 *
 * Written to tolerate a half-arrived message: this renders on every streamed
 * chunk, so an unterminated code fence has to produce a code block rather than
 * swallow the rest of the answer or throw.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (text !== "") blocks.push({ type: "paragraph", children: parseInline(text) });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const language = fence[1].trim() || null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      // Skip the closing fence if there was one; if not, we ran off the end
      // mid-stream and the block still renders.
      i += 1;
      blocks.push({ type: "code", language, value: body.join("\n") });
      continue;
    }

    // A table is recognised by its *second* line, so this looks ahead one line
    // rather than committing on the first. A lone row of pipes with no divider
    // under it is prose and stays prose.
    const next = lines[i + 1];
    if (line.includes("|") && next !== undefined && TABLE_DIVIDER.test(next)) {
      const header = splitRow(line);
      const align = rowAlignment(next);
      if (header.length > 1 && align.length === header.length) {
        flushParagraph();
        const rows: InlineNode[][][] = [];
        let cursor = i + 2;
        while (
          cursor < lines.length &&
          lines[cursor].trim() !== "" &&
          lines[cursor].includes("|")
        ) {
          const cells = splitRow(lines[cursor]);
          // Ragged rows are normal in a half-streamed message and in output a
          // model wrote by hand; pad or trim to the header rather than dropping
          // the row, so the table renders while it is still arriving.
          const padded = Array.from({ length: header.length }, (_, column) =>
            parseInline(cells[column] ?? ""),
          );
          rows.push(padded);
          cursor += 1;
        }
        blocks.push({
          type: "table",
          align,
          header: header.map(parseInline),
          rows,
        });
        i = cursor;
        continue;
      }
    }

    // A thematic break. Checked *after* the table, because `---` is also a
    // table's divider row and the table branch above has already claimed it if
    // the line before was a header. The assistant separates sections with these
    // constantly, and without this they arrived as three literal dashes.
    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2].trim()),
      });
      i += 1;
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null && bullet === null;
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const current = lines[i];
        const asBullet = BULLET.exec(current);
        const asNumbered = NUMBERED.exec(current);
        const isSameKind = ordered ? asNumbered !== null && asBullet === null : asBullet !== null;
        if (!isSameKind) break;
        items.push(parseInline(((ordered ? asNumbered : asBullet) as RegExpExecArray)[1].trim()));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flushParagraph();
  return blocks;
}
