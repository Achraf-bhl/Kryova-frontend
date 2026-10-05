"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  browserStorage,
  buildCrashReport,
  readOffer,
  stopOffering,
  type ReportError,
  type TranscriptMessage,
} from "@/lib/crash-report";

/**
 * "Send a report" on an error page (ROAD_TO_10 9.2).
 *
 * Shows the whole report before anything is sent, sends only on the Send click, and offers the
 * conversation's messages only when the page that mounted it can supply them — default off.
 * Renders nothing outside the desktop shell (the route 404s) and nothing once the person has
 * said stop asking.
 */
export interface CrashReportButtonProps {
  error: ReportError;
  route: string;
  /** Supplied only by a page that has a conversation. Absent means the box is not shown. */
  loadTranscript?: () => Promise<TranscriptMessage[]>;
}

type State =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "open"; configured: boolean; logs: { name: string; tail: string }[] }
  | { kind: "sent" }
  | { kind: "failed"; message: string; report: string };

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";

export function CrashReportButton({ error, route, loadTranscript }: CrashReportButtonProps) {
  const [state, setState] = useState<State>({ kind: "closed" });
  const [withTranscript, setWithTranscript] = useState(false);
  const [report, setReport] = useState("");
  const [hidden, setHidden] = useState(() => readOffer(browserStorage()) === "never");

  if (hidden) return null;

  async function assemble(
    logs: { name: string; tail: string }[],
    include: boolean,
  ): Promise<string> {
    const transcript = include && loadTranscript ? await loadTranscript() : undefined;
    return buildCrashReport({
      appVersion: APP_VERSION,
      platform: navigator.platform,
      generatedAt: new Date().toISOString(),
      route,
      error,
      logs,
      transcript,
    });
  }

  async function open() {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/crash-report", { cache: "no-store" });
      // 404 is the web deployment's designed answer: there is nothing to report from here.
      if (response.status === 404) {
        setHidden(true);
        return;
      }
      const data = (await response.json()) as {
        configured: boolean;
        logs: { name: string; tail: string }[];
      };
      setReport(await assemble(data.logs, false));
      setState({ kind: "open", configured: data.configured, logs: data.logs });
    } catch {
      setHidden(true);
    }
  }

  async function toggleTranscript(checked: boolean) {
    setWithTranscript(checked);
    if (state.kind === "open") setReport(await assemble(state.logs, checked));
  }

  async function send() {
    try {
      const response = await fetch("/api/crash-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, consent: true }),
      });
      if (response.ok) {
        setState({ kind: "sent" });
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setState({ kind: "failed", message: data.error ?? `HTTP ${response.status}`, report });
    } catch (failure) {
      setState({
        kind: "failed",
        message: failure instanceof Error ? failure.message : "The report could not be sent.",
        report,
      });
    }
  }

  if (state.kind === "closed" || state.kind === "loading") {
    return (
      <Button variant="secondary" onClick={() => void open()} disabled={state.kind === "loading"}>
        Send a report
      </Button>
    );
  }
  if (state.kind === "sent") {
    return <p role="status" className="text-sm text-muted">Report sent. Thank you.</p>;
  }

  return (
    <section aria-label="Crash report" className="mt-4 max-w-prose">
      <p className="text-sm text-muted">
        This is everything that would be sent. Nothing leaves this computer until you press Send.
        Your files, geometry and attachments are never part of it.
      </p>
      <label className="sr-only" htmlFor="crash-report-text">Report text</label>
      <textarea
        id="crash-report-text"
        readOnly
        value={report}
        rows={10}
        className="mt-2 w-full rounded-md border border-border bg-canvas p-2 font-mono text-xs"
      />
      {loadTranscript && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withTranscript}
            onChange={(event) => void toggleTranscript(event.target.checked)}
          />
          Include this conversation&apos;s messages
        </label>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="mt-2 text-sm text-danger">
          Not sent: {state.message}. You can copy the text above instead.
        </p>
      )}
      {state.kind === "open" && !state.configured && (
        <p className="mt-2 text-sm text-muted">
          This install has no place to send reports. Copy the text above into a bug report.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button onClick={() => void send()} disabled={state.kind === "open" && !state.configured}>
          Send
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            stopOffering(browserStorage());
            setHidden(true);
          }}
        >
          Don&apos;t ask again
        </Button>
      </div>
    </section>
  );
}
