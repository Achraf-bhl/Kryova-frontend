import { open, stat } from "node:fs/promises";
import path from "node:path";

/**
 * What the setup page's "Copy diagnostics" can read off this machine (ROAD_TO_10 4.8).
 *
 * The desktop shell keeps the last launches of the backend's and the frontend's logs in one
 * folder (`src-tauri/src/logs.rs`) and tells this server where with `KRYOVA_LOG_DIR`. A person
 * whose app will not start can then paste one block into a bug report instead of hunting for
 * `%LOCALAPPDATA%\Kryova\logs`.
 *
 * Three things keep that from being a hole, and each is tested:
 *
 * - **It is opt-in twice.** Nothing is read unless `KRYOVA_DESKTOP=1` *and* a log directory are
 *   set, which only the shell does. A web deployment answers 404 and never serves its host's
 *   files.
 * - **Only fixed names are ever opened**, joined onto that directory. No part of a request
 *   reaches a path, so there is nothing to traverse.
 * - **What is read is scrubbed before it leaves.** A traceback quotes a connection string, a
 *   header or a token, and the report is made to be pasted somewhere public.
 */

/** The files, current launch first. `.1.log` is the launch before: the crash someone restarted past. */
export const LOG_FILES = ["backend.log", "backend.1.log", "frontend.log", "frontend.1.log"] as const;

/** Per file. A crash is at the end of a log, and 16 KiB of it is a screenful of traceback. */
export const TAIL_BYTES = 16 * 1024;

export interface LogTail {
  name: string;
  /** Size on disk, so a truncated tail says how much was left out. */
  bytes: number;
  modified: string;
  truncated: boolean;
  tail: string;
}

export interface ServerDiagnostics {
  generated_at: string;
  node: string;
  platform: string;
  arch: string;
  logs: LogTail[];
  /** Files that were not there, or could not be read. A missing log is itself a finding. */
  unavailable: { name: string; reason: string }[];
}

type Env = Record<string, string | undefined>;

/** The log directory, or `null` when this server was not started by the desktop shell. */
export function diagnosticsDirectory(env: Env): string | null {
  if (env.KRYOVA_DESKTOP !== "1") return null;
  const dir = env.KRYOVA_LOG_DIR?.trim();
  return dir ? dir : null;
}

/**
 * Whether a request's `Host` is this machine.
 *
 * `next start` listens on every interface unless told otherwise, and a route that serves logs
 * must not answer a neighbour on the LAN, nor a page on another site that has pointed its own
 * name at 127.0.0.1 (DNS rebinding sends the *attacker's* host name). The shell also binds
 * loopback; this is the second lock, because a first that is configuration alone is one
 * mistyped flag from open.
 */
export function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

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

/**
 * The last `maxBytes` of a file as text, starting on a line boundary.
 *
 * Read by position, never the whole file: a backend left running for a month has a log of
 * hundreds of megabytes, and "copy diagnostics" must not be the thing that runs the machine out
 * of memory.
 */
export async function readTail(
  file: string,
  maxBytes: number = TAIL_BYTES,
): Promise<{ bytes: number; modified: Date; truncated: boolean; text: string }> {
  const info = await stat(file);
  const length = Math.min(info.size, maxBytes);
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, info.size - length);
    let text = buffer.toString("utf8");
    const truncated = info.size > length;
    if (truncated) {
      // The first line is almost certainly cut in half; keep only what is whole.
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1);
    }
    return { bytes: info.size, modified: info.mtime, truncated, text };
  } finally {
    await handle.close();
  }
}

export async function collectServerDiagnostics(
  env: Env,
  now: Date = new Date(),
): Promise<ServerDiagnostics | null> {
  const dir = diagnosticsDirectory(env);
  if (dir === null) return null;

  const logs: LogTail[] = [];
  const unavailable: { name: string; reason: string }[] = [];
  for (const name of LOG_FILES) {
    try {
      const read = await readTail(path.join(dir, name));
      logs.push({
        name,
        bytes: read.bytes,
        modified: read.modified.toISOString(),
        truncated: read.truncated,
        tail: redact(read.text),
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      unavailable.push({
        name,
        // The two readable causes get words; anything else is the platform's own code.
        reason: code === "ENOENT" ? "not present" : `could not be read (${code ?? "unknown error"})`,
      });
    }
  }

  return {
    generated_at: now.toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    logs,
    unavailable,
  };
}
