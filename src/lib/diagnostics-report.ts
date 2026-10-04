import type { ServerDiagnostics } from "@/lib/diagnostics";

/**
 * The block a person pastes into a bug report (ROAD_TO_10 4.8).
 *
 * Plain text, one section per source, with each source saying what it could not tell: a
 * report that silently lacks the backend's log reads as "the backend logged nothing", which is
 * a different and much worse sentence than "the logs were not available here".
 */

export interface ClientCheck {
  id: string;
  label: string;
  ok: boolean;
  error?: string;
}

export interface ReportInput {
  generatedAt: string;
  platform: string;
  userAgent: string;
  apiUrl: string;
  checks: ClientCheck[];
  /** `null` when the route is absent (a web deployment); a string when it was refused or failed. */
  server: ServerDiagnostics | null | { error: string };
}

function isFailure(server: ReportInput["server"]): server is { error: string } {
  return server !== null && "error" in server;
}

export function formatReport(input: ReportInput): string {
  const lines: string[] = [
    "Kryova diagnostics",
    `Generated: ${input.generatedAt}`,
    `Platform: ${input.platform}`,
    `Browser: ${input.userAgent}`,
    `API: ${input.apiUrl}`,
    "",
    "Checks",
    ...input.checks.map(
      (check) => `  [${check.ok ? "ok" : "FAILED"}] ${check.label}${check.error ? ` -- ${check.error}` : ""}`,
    ),
    "",
  ];

  if (input.server === null) {
    lines.push("Logs: not collected. Only the desktop app keeps logs for this report.");
  } else if (isFailure(input.server)) {
    lines.push(`Logs: could not be collected (${input.server.error}).`);
  } else {
    lines.push(
      `Logs (${input.server.platform} ${input.server.arch}, node ${input.server.node}, read ${input.server.generated_at})`,
    );
    for (const name of input.server.unavailable) {
      lines.push(``, `--- ${name.name}: ${name.reason}`);
    }
    for (const log of input.server.logs) {
      lines.push(
        ``,
        `--- ${log.name} (${log.bytes} bytes, modified ${log.modified}${log.truncated ? ", showing the end" : ""})`,
        log.tail.trimEnd() || "(empty)",
      );
    }
  }
  return lines.join("\n");
}
