"use client";

import { useEffect, useState } from "react";

import { API_BASE_URL, api } from "@/lib/api-client";
import {
  firstPrompt,
  healthUrl,
  interpretHealth,
  interpretMachine,
  type CheckRow,
  type CheckState,
  type HealthBody,
} from "@/lib/machine-checks";

const MARK: Record<CheckState, { glyph: string; tone: string; word: string }> = {
  ok: { glyph: "✓", tone: "bg-success/15 text-success", word: "ready" },
  problem: { glyph: "✕", tone: "bg-danger/15 text-danger", word: "needs attention" },
  note: { glyph: "•", tone: "bg-warning/15 text-warning", word: "note" },
  unknown: { glyph: "?", tone: "bg-canvas text-faint", word: "could not be read" },
};

/** The rows, each with a mark that also reads aloud (colour is never the only signal). */
export function CheckList({ rows }: { rows: CheckRow[] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => {
        const mark = MARK[row.state];
        return (
          <li key={row.id} className="flex items-start gap-3 py-2.5">
            <span
              aria-hidden
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${mark.tone}`}
            >
              {mark.glyph}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {row.label}
                <span className="sr-only"> — {mark.word}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted">{row.detail}</p>
              {row.fix && <p className="mt-1 text-xs text-danger">{row.fix}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The model and where parts are built, from `/ai/status` and `/catia/status`, with a first
 * message worth sending once both are there. Signed-in only: both routes need an account.
 * A route that cannot be read is an `unknown` row, never an error banner.
 */
export function MachineChecks() {
  const [rows, setRows] = useState<CheckRow[] | null>(null);

  useEffect(() => {
    let current = true;
    void Promise.allSettled([api.aiStatus(), api.catiaStatus()]).then(([ai, catia]) => {
      if (!current) return;
      setRows(
        interpretMachine({
          ai: ai.status === "fulfilled" ? ai.value : null,
          catia: catia.status === "fulfilled" ? catia.value : null,
        }),
      );
    });
    return () => {
      current = false;
    };
  }, []);

  if (!rows) return null;
  const prompt = firstPrompt(rows);
  return (
    <div className="mt-4" data-testid="machine-checks">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">This machine</h3>
      <CheckList rows={rows} />
      {prompt && (
        <p className="mt-2 text-xs text-muted">
          A good first message: <span className="text-accent">“{prompt}”</span>
        </p>
      )}
    </div>
  );
}

/** The database and file storage, from the unauthenticated `/health` — usable on the setup page. */
export function ServerHealth() {
  const [rows, setRows] = useState<CheckRow[] | null>(null);

  useEffect(() => {
    let current = true;
    fetch(healthUrl(API_BASE_URL), { signal: AbortSignal.timeout(5000) })
      // A 503 still carries the body that says which check failed.
      .then((response) => response.json() as Promise<HealthBody>)
      .catch(() => null)
      .then((body) => {
        if (current) setRows(interpretHealth(body));
      });
    return () => {
      current = false;
    };
  }, []);

  if (!rows) return null;
  return (
    <div className="mt-4" data-testid="server-health">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Server</h3>
      <CheckList rows={rows} />
    </div>
  );
}
