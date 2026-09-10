import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Where a credential may live in this client, enforced rather than asserted in
 * a document (P1.8).
 *
 * Auth here is httpOnly cookies plus a CSRF header. The access and refresh
 * tokens are **unreadable by JavaScript by construction** — that is the whole
 * design, and the thing that can quietly undo it is one `localStorage.setItem`
 * added by somebody solving a different problem. `kryova_token` in
 * `localStorage` is not hypothetical here: it is what this codebase shipped
 * before the cookie rewrite, and it is recorded as a fixed landmine precisely
 * so it does not come back.
 *
 * The CSRF cookie is deliberately *not* httpOnly and is read by JS — that is
 * how double-submit works and it is not a token in the credential sense. It
 * lives in a cookie, not in storage, so nothing here needs to except it.
 *
 * **The desktop client is covered by the same test**, because it is the same
 * client: Tauri renders this frontend in a webview and the cookie flow works
 * there unchanged. There is no native token cache and `src-tauri/` handles no
 * credential — which is why P1.8's "OS keychain if a native cache is ever
 * needed" stays a conditional. A file-backed token store is the thing that rule
 * exists to forbid, and the way to keep it forbidden is to not need one.
 */

const SOURCE_ROOT = join(process.cwd(), "src");

/** Storage APIs a token must never reach. */
const FORBIDDEN = [
  { pattern: /\blocalStorage\b/, name: "localStorage" },
  { pattern: /\bsessionStorage\b/, name: "sessionStorage" },
  { pattern: /\bindexedDB\b/, name: "indexedDB" },
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

describe("token custody", () => {
  it("keeps every credential out of browser storage", () => {
    // Test files are excluded: `login/page.test.tsx` asserts localStorage stays
    // *empty*, which is the same rule from the other side and must not be
    // caught by its own guard.
    const offenders: string[] = [];
    for (const path of sourceFiles(SOURCE_ROOT)) {
      if (/\.test\.tsx?$/.test(path)) continue;
      const source = readFileSync(path, "utf8");
      for (const { pattern, name } of FORBIDDEN) {
        if (pattern.test(source)) {
          offenders.push(`${path.replace(process.cwd(), ".")} uses ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds source files at all, so an empty pass cannot be a vacuous one", () => {
    // A guard that scans nothing passes forever. This is the same failure the
    // backend's RLS test hit for a year, in miniature.
    expect(sourceFiles(SOURCE_ROOT).length).toBeGreaterThan(50);
  });

  it("has no bearer token written into a request by hand", () => {
    // The browser attaches the session automatically because the cookies are
    // scoped to the API path. An explicit `Authorization: Bearer` header in
    // this client would mean a token had been read from somewhere — and the
    // only somewhere available is storage.
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => /Authorization["']?\s*:/i.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
