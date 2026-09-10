"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import type { RunEstimate } from "@/types/api";

/**
 * What a run is likely to cost, before it starts (P5.7).
 *
 * **The number comes from the meter that bills**, not from a separate model of
 * cost — P8.4's "one number, two uses; divergence is a bug class of its own".
 * This component does no arithmetic at all: the backend projects from the
 * tenant's own recorded runs and hands back a sentence, and rendering the
 * sentence is how the two stay identical.
 *
 * **An estimate with too little history is shown as such**, never as zero and
 * never hidden. "We cannot estimate this yet, because you have run two
 * simulations and we need three" is a useful thing to tell somebody; a blank
 * space where a cost should be is not, and a made-up figure is worse than
 * either — a cost estimate is the one number in a product that is never
 * contradicted afterwards, which is exactly why an invented one survives.
 */
export function CostNotice({ organisationId }: { organisationId: string }) {
  const [estimates, setEstimates] = useState<RunEstimate[] | null>(null);

  useEffect(() => {
    api
      .runEstimate(organisationId)
      .then((body) => setEstimates(body.estimates))
      // Silent: an estimate is advisory, and a failure to fetch one must not
      // become an error banner above a form that works perfectly well.
      .catch(() => setEstimates(null));
  }, [organisationId]);

  if (!estimates || estimates.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <p className="text-xs font-medium text-muted">Before you run this</p>
      <ul className="mt-1 space-y-1">
        {estimates.map((estimate) => (
          <li
            key={estimate.meter}
            className={`text-sm ${estimate.units === null ? "text-muted" : "text-accent"}`}
          >
            {/* The sentence the backend built. Assembling our own from `units`
                and `unit` would be a second place for the wording — and the
                honesty — to drift. */}
            {estimate.sentence}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Elapsed against the estimate, while a run is going (P5.7's middle third).
 *
 * Shows overrun **as a fact rather than an alarm**: a run past its estimate is
 * ordinary — the estimate is a median, so half of all runs exceed it by
 * construction — and colouring it red would teach people that the product is
 * usually broken. It turns amber only at twice the estimate, where something
 * genuinely is different about this run.
 */
export function ElapsedAgainstEstimate({
  startedAt,
  estimateSeconds,
  now = new Date(),
}: {
  startedAt: string;
  estimateSeconds: number | null;
  now?: Date;
}) {
  const elapsed = Math.max(0, (now.getTime() - new Date(startedAt).getTime()) / 1000);
  const elapsedLabel = elapsed < 90 ? `${Math.round(elapsed)}s` : `${Math.round(elapsed / 60)}m`;

  if (estimateSeconds === null || estimateSeconds <= 0) {
    return <span className="text-xs text-muted">running for {elapsedLabel}</span>;
  }

  const ratio = elapsed / estimateSeconds;
  const tone = ratio > 2 ? "text-warning" : "text-muted";
  return (
    <span className={`text-xs ${tone}`}>
      running for {elapsedLabel} · estimated {Math.round(estimateSeconds)}s
      {ratio > 2 && " — this one is taking much longer than your usual"}
    </span>
  );
}
