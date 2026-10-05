/**
 * Scrubbing text that is about to leave the machine (ROAD_TO_10 4.8, 9.2).
 *
 * Pure and free of `node:` imports so the browser can use it: the crash report's transcript is
 * read in the page, and a scrub that only the server can run would mean the unscrubbed text
 * crossed the wire first. `lib/diagnostics.ts` re-exports `redact` for its own callers.
 */

const REDACTIONS: [RegExp, string][] = [
  // `scheme://user:password@host` — a database or broker URL in a traceback.
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi, "$1[redacted]$2"],
  // A header or cookie value.
  [/\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"',;]+/gi, "$1[redacted]"],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]"],
  [/\b(kryova_(?:access|refresh|csrf)\s*=\s*)[^\s;"',]+/gi, "$1[redacted]"],
  [/\b(x-csrf-token\s*[:=]\s*)[^\s"',;]+/gi, "$1[redacted]"],
  // A JWT is three base64url segments, the first of which starts `eyJ`.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[redacted-token]"],
  // `password=…`, `api_key: …`, `secret=…` wherever they appear.
  [/\b((?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*)(?!\[redacted)[^\s"',;]+/gi, "$1[redacted]"],
  // A key as a vendor issues it.
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[redacted-key]"],
];

/** Scrub what a log line may quote that must not be pasted into a public issue. */
export function redact(text: string): string {
  return REDACTIONS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}
