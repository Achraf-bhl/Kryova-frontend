"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ServerDiagnostics } from "@/lib/diagnostics";
import { formatReport, type ReportInput } from "@/lib/diagnostics-report";
import type { HealthCheckResult, Platform } from "@/lib/system";

/**
 * "Copy diagnostics" on the setup page (ROAD_TO_10 4.8).
 *
 * The page a person sees when the app will not start is the one place that must work while the
 * backend is down, so it asks the *Next* server for the log tails (`/api/diagnostics`) and
 * adds what only the browser knows — which checks failed and why. If the clipboard is refused
 * (a webview may), the report is shown in a box to select by hand rather than lost: the button
 * exists so that nobody has to go and find a log folder, and "copy failed" with nothing to
 * copy instead would put them back there.
 */
export interface CopyDiagnosticsProps {
  checks: HealthCheckResult[];
  platform: Platform;
}

type Outcome =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "copied" }
  | { kind: "manual"; report: string };

async function readServer(): Promise<ReportInput["server"]> {
  try {
    const response = await fetch("/api/diagnostics", { cache: "no-store" });
    // 404 is the designed answer of a web deployment: there are no logs to offer.
    if (response.status === 404) return null;
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return (await response.json()) as ServerDiagnostics;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "the request failed" };
  }
}

export function CopyDiagnostics({ checks, platform }: CopyDiagnosticsProps) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  async function collect() {
    setOutcome({ kind: "working" });
    const report = formatReport({
      generatedAt: new Date().toISOString(),
      platform,
      userAgent: navigator.userAgent,
      apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1",
      checks: checks.map(({ prerequisite, ok, error }) => ({
        id: prerequisite.id,
        label: prerequisite.label,
        ok,
        error,
      })),
      server: await readServer(),
    });
    try {
      await navigator.clipboard.writeText(report);
      setOutcome({ kind: "copied" });
    } catch {
      setOutcome({ kind: "manual", report });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        onClick={() => void collect()}
        disabled={outcome.kind === "working"}
        className="w-full"
      >
        {outcome.kind === "working" ? "Collecting…" : "Copy diagnostics"}
      </Button>
      {outcome.kind === "copied" && (
        <p role="status" className="text-center text-xs text-muted">
          Copied. Paste it into your bug report.
        </p>
      )}
      {outcome.kind === "manual" && (
        <>
          <p role="status" className="text-xs text-muted">
            The clipboard was not available. Select everything below and copy it.
          </p>
          <textarea
            readOnly
            aria-label="Diagnostics report"
            value={outcome.report}
            onFocus={(event) => event.currentTarget.select()}
            className="h-48 w-full rounded-md border border-border bg-canvas p-2 font-mono text-xs"
          />
        </>
      )}
    </div>
  );
}
