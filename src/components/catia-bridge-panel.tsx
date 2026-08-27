"use client";

import { useCatiaBridge } from "@/hooks/use-catia-bridge";

const STATE_LABEL: Record<string, { text: string; dot: string; text_color: string }> = {
  connected: { text: "Connected", dot: "bg-success", text_color: "text-success" },
  connecting: { text: "Connecting…", dot: "bg-primary animate-pulse", text_color: "text-primary" },
  disconnected: { text: "Disconnected", dot: "bg-muted", text_color: "text-muted" },
  error: { text: "Error", dot: "bg-danger", text_color: "text-danger" },
};

export function CatiaBridgePanel() {
  const { status, events, lastEvent, connect, disconnect } = useCatiaBridge();

  const state = STATE_LABEL[status.state] ?? STATE_LABEL.disconnected;

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`size-2 rounded-full ${state.dot}`} aria-hidden />
          <span className={`text-sm font-semibold ${state.text_color}`}>{state.text}</span>
          {status.version && (
            <span className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-muted">
              CATIA V{status.version}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={status.state === "disconnected" ? connect : disconnect}
          className="text-xs font-medium text-muted underline-offset-2 transition hover:text-accent hover:underline"
        >
          {status.state === "disconnected" ? "Connect" : "Disconnect"}
        </button>
      </div>

      {status.error_message && (
        <p className="border-b border-border bg-danger/5 px-4 py-2 text-xs text-danger">
          {status.error_message}
        </p>
      )}

      {lastEvent && (
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted">Last activity</p>
          <p className="mt-0.5 text-sm font-medium">{lastEvent.type.replace(/_/g, " ")}</p>
          <p className="text-xs text-muted">
            {lastEvent.document_name} · {new Date(lastEvent.timestamp).toLocaleTimeString()}
          </p>
        </div>
      )}

      {events.length > 0 && (
        <div className="max-h-40 overflow-y-auto px-4 py-2">
          <ul className="space-y-1">
            {events.slice(0, 10).map((event, index) => (
              <li key={`${event.timestamp}-${index}`} className="flex items-center gap-2 text-xs">
                <span className="inline-block size-1.5 rounded-full bg-border" aria-hidden />
                <span className="text-muted">{event.type.replace(/_/g, " ")}</span>
                <span className="ml-auto tabular-nums text-muted/70">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!lastEvent && status.state === "connected" && (
        <p className="px-4 py-3 text-sm text-muted">
          Waiting for geometry changes from CATIA…
        </p>
      )}
    </div>
  );
}
