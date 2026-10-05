import { redact } from "@/lib/redact";

/**
 * A crash report a person chooses to send (ROAD_TO_10 9.2).
 *
 * **Opt-in at every send, and never automatic.** There is no background reporter and no
 * "send reports" switch that stays on: the dialog shows the exact text, and one click on Send
 * is the consent for that one report. A stored preference exists only to *stop asking*.
 *
 * What a report may hold is decided here, by what the builder accepts:
 *
 * - the app version, the platform and the error;
 * - the tail of the backend's and the shell's logs, already scrubbed by `lib/diagnostics.ts`;
 * - **a conversation's messages only when the person ticked the box** for that report.
 *
 * It takes no input for an attachment, a file's contents, a geometry or a project — there is
 * nothing to leave out because there is no way to put it in. `tests/…` pins that the builder's
 * parameter list has no such field.
 */

export interface ReportError {
  message?: string;
  digest?: string;
  stack?: string;
}

export interface ReportLog {
  name: string;
  tail: string;
}

export interface TranscriptMessage {
  role: string;
  content: string;
}

export interface CrashReportInput {
  appVersion: string;
  platform: string;
  generatedAt: string;
  /** Where in the app it happened — a path, never a query string. */
  route: string;
  error: ReportError;
  logs: ReportLog[];
  /** Present only if the person ticked the box. Absent means none, not "empty". */
  transcript?: TranscriptMessage[];
}

/** Per message: a pasted STEP file or a log is not a message, and the report has a size cap. */
export const MAX_MESSAGE_CHARS = 4_000;
/** The whole report. The route refuses anything larger. */
export const MAX_REPORT_BYTES = 256 * 1024;

function stripQuery(route: string): string {
  const cut = route.search(/[?#]/);
  return cut === -1 ? route : route.slice(0, cut);
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[… ${text.length - limit} more characters left out]`;
}

export function buildCrashReport(input: CrashReportInput): string {
  const lines: string[] = [
    "Kryova crash report",
    `Version: ${input.appVersion}`,
    `Generated: ${input.generatedAt}`,
    `Platform: ${input.platform}`,
    `Where: ${stripQuery(input.route)}`,
    "",
    "Error",
    `  ${redact(input.error.message?.trim() || "(no message)")}`,
  ];
  if (input.error.digest) lines.push(`  Reference: ${input.error.digest}`);
  if (input.error.stack) lines.push("", redact(clip(input.error.stack, 4_000)));

  lines.push("");
  if (input.logs.length === 0) {
    lines.push("Logs: none were available.");
  }
  for (const log of input.logs) {
    lines.push(`--- ${log.name}`, redact(log.tail).trimEnd() || "(empty)", "");
  }

  if (input.transcript === undefined) {
    lines.push("Conversation: not included.");
  } else {
    lines.push(`Conversation: included at the person's request (${input.transcript.length} messages)`);
    for (const message of input.transcript) {
      lines.push(`--- ${message.role}`, redact(clip(message.content, MAX_MESSAGE_CHARS)));
    }
  }
  return lines.join("\n");
}

export function reportBytes(report: string): number {
  return new TextEncoder().encode(report).length;
}

/** The one stored preference: stop offering. Anything else, including a stale value, asks. */
export const CONSENT_KEY = "kryova.crash-report";

export type Offer = "ask" | "never";

/** The page's storage, or null where there is none or it throws (a private window, SSR). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readOffer(storage: Pick<Storage, "getItem"> | null): Offer {
  try {
    return storage?.getItem(CONSENT_KEY) === "never" ? "never" : "ask";
  } catch {
    return "ask";
  }
}

export function stopOffering(storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(CONSENT_KEY, "never");
  } catch {
    /* A storage that refuses is a person who will be asked again, which is the safe direction. */
  }
}

/** Only an `https:` endpoint, or one on this machine: a report is not sent in the clear. */
export function isAcceptableEndpoint(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}
