"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { ResultInterpretation } from "@/types/api";

const VERDICT: Record<
  ResultInterpretation["verdict"],
  { label: string; className: string }
> = {
  safe: { label: "Passes", className: "bg-success/10 text-success border-success/30" },
  marginal: { label: "Marginal", className: "bg-danger/10 text-danger border-danger/30" },
  yields: { label: "Yields", className: "bg-danger/10 text-danger border-danger/30" },
};

const SEVERITY: Record<string, string> = {
  critical: "text-danger",
  warning: "text-danger/80",
  info: "text-muted",
};

/** On-demand AI reading of a finished run.
 *
 * Not fetched on mount: it costs a model call, and most visits to a result page
 * are to look at the viewer, not to ask for an opinion.
 */
export function ResultInterpretationPanel({
  projectId,
  simulationId,
}: {
  projectId: string;
  simulationId: string;
}) {
  const [data, setData] = useState<ResultInterpretation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function explain() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.interpretSimulation(projectId, simulationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Explain this result</h3>
            <p className="text-xs text-muted">
              An engineering read of the numbers above, and what to change.
            </p>
          </div>
          <Button type="button" onClick={() => void explain()} loading={loading}>
            {loading ? "Reading…" : "Explain"}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  const verdict = VERDICT[data.verdict];

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${verdict.className}`}
        >
          {verdict.label}
        </span>
        <span className="text-xs text-muted">confidence: {data.confidence}</span>
        <button
          type="button"
          onClick={() => void explain()}
          className="ml-auto text-xs text-muted underline-offset-2 hover:underline"
        >
          Re-read
        </button>
      </div>

      <p className="text-sm font-medium">{data.headline}</p>

      <ul className="space-y-2">
        {data.findings.map((finding) => (
          <li key={finding.title} className="border-l-2 border-border pl-3">
            <p className={`text-sm font-medium ${SEVERITY[finding.severity] ?? ""}`}>
              {finding.title}
            </p>
            <p className="text-sm text-muted">{finding.detail}</p>
          </li>
        ))}
      </ul>

      {data.suggestions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Suggestions
          </p>
          <ul className="space-y-2">
            {data.suggestions.map((suggestion) => (
              <li key={suggestion.change} className="rounded-md bg-canvas p-2.5">
                <p className="text-sm font-medium">{suggestion.change}</p>
                <p className="text-sm text-muted">{suggestion.rationale}</p>
                {/* Never hidden: a change that only adds mass is not free. */}
                <p className="mt-1 text-xs text-muted">
                  <span className="font-medium">Trade-off:</span> {suggestion.tradeoff}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-border pt-3 text-xs text-muted">{data.caveat}</p>
    </div>
  );
}
