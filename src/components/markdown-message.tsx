import { Fragment } from "react";

import { parseMarkdown, type InlineNode, type MarkdownBlock } from "@/lib/markdown";

/**
 * Render an agent message.
 *
 * The parser (`lib/markdown.ts`) produces nodes and this maps them onto React
 * elements one for one. Model output never becomes an HTML string on the way —
 * there is no `dangerouslySetInnerHTML` here, so there is no injection sink to
 * get wrong.
 */

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>
          {node.type === "text" ? (
            node.value
          ) : node.type === "strong" ? (
            <strong className="font-semibold text-accent">
              <Inline nodes={node.children} />
            </strong>
          ) : node.type === "em" ? (
            <em>
              <Inline nodes={node.children} />
            </em>
          ) : node.type === "code" ? (
            <code className="rounded-sm bg-surface-sunken px-1 py-0.5 font-mono text-[0.85em] text-blueprint">
              {node.value}
            </code>
          ) : (
            <a
              href={node.href}
              className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
              {...(node.href.startsWith("http")
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              <Inline nodes={node.children} />
            </a>
          )}
        </Fragment>
      ))}
    </>
  );
}

const ALIGN = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.type) {
    case "heading": {
      const size =
        block.level === 1 ? "text-base" : block.level === 2 ? "text-[0.95rem]" : "text-sm";
      return (
        <p className={`font-display font-semibold text-accent ${size}`}>
          <Inline nodes={block.children} />
        </p>
      );
    }
    case "code":
      return (
        <pre className="k-scroll overflow-x-auto rounded-md border border-border bg-surface-sunken p-3">
          <code className="font-mono text-xs leading-relaxed text-accent">{block.value}</code>
        </pre>
      );
    case "list":
      return block.ordered ? (
        <ol className="list-decimal space-y-1 pl-5 marker:font-mono marker:text-faint">
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 marker:text-faint">
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </ul>
      );
    case "rule":
      return <hr className="border-0 border-t border-border" />;
    case "table":
      // `overflow-x-auto` on the wrapper, not the table: an engineering
      // comparison runs to five or six columns, and without its own scroller
      // the widest row pushes the whole transcript sideways.
      return (
        <div className="k-scroll -mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-max border-collapse text-[0.875rem] tabular-nums">
            <thead>
              <tr className="border-b border-border">
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    className={`px-2.5 py-1.5 font-display font-semibold text-accent ${ALIGN[block.align[index] ?? "left"]}`}
                  >
                    <Inline nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border/50 last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={`px-2.5 py-1.5 align-top ${ALIGN[block.align[cellIndex] ?? "left"]}`}
                    >
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p className="whitespace-pre-wrap">
          <Inline nodes={block.children} />
        </p>
      );
  }
}

export function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseMarkdown(content);
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-3 text-[0.9375rem] leading-relaxed text-accent">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
