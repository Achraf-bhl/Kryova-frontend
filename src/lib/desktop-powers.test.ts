import { describe, expect, it } from "vitest";

import {
  DEEP_LINK_TARGETS,
  MAX_LOCAL_FILE_BYTES,
  NOTIFY_AFTER_SECONDS,
  canOpen,
  noticeFor,
  parseDeepLink,
  routeFor,
} from "./desktop-powers";

/**
 * P7 task 3's decidable half.
 *
 * This module and these tests were claimed by the master plan on 2026-09-16 and had never
 * been committed — one of ten such paths found by the audit of 2026-09-17. The security
 * argument survived in the status that claimed it, and the deep-link tests below are
 * written as the attacks they refuse, because that is the half of this task that matters:
 * the link arrives in an email, the person clicking it cannot read it first, and the app
 * it opens is already signed in.
 */

function ok(raw: string) {
  const link = parseDeepLink(raw);
  if (!link.ok) throw new Error(`expected ${raw} to parse: ${link.reason}`);
  return link;
}

describe("a deep link is an allow-list of shapes", () => {
  it.each(DEEP_LINK_TARGETS)("accepts a %s link with one id", (target) => {
    const link = ok(`kryova://${target}/abc123`);

    expect(link.target).toBe(target);
    expect(link.id).toBe("abc123");
  });

  it("accepts a uuid", () => {
    expect(ok("kryova://run/3f2b7c1e-9a44-4d1b-b0aa-8c2e5d6f7a01").id).toHaveLength(36);
  });

  it("refuses every other scheme by name", () => {
    for (const raw of [
      "https://evil.example/run/1",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "kryovax://run/1",
    ]) {
      const link = parseDeepLink(raw);
      expect(link.ok).toBe(false);
      expect(link.ok === false && link.reason.length).toBeGreaterThan(10);
    }
  });

  it("refuses a target that is not on the list", () => {
    // The list is three read-only views. A target that acted would be a one-click remote
    // command against an authenticated session.
    for (const target of ["admin", "delete", "approve", "settings", "run-now"]) {
      expect(parseDeepLink(`kryova://${target}/1`).ok).toBe(false);
    }
  });

  it("refuses more than one id segment", () => {
    const link = parseDeepLink("kryova://project/a/b");

    expect(link.ok).toBe(false);
    expect(link.ok === false && link.reason).toContain("exactly one");
  });

  it("refuses no id at all", () => {
    expect(parseDeepLink("kryova://run").ok).toBe(false);
    expect(parseDeepLink("kryova://run/").ok).toBe(false);
  });

  it("refuses traversal and separators inside the id", () => {
    // An id is never `..`, never has a slash and never carries a query. A pattern that
    // permitted those is how a deep link addresses something the list did not intend.
    for (const raw of [
      "kryova://project/..",
      "kryova://project/%2e%2e",
      "kryova://project/a b",
      "kryova://project/a;b",
    ]) {
      expect(parseDeepLink(raw).ok).toBe(false);
    }
  });

  it("refuses something that is not a link at all", () => {
    expect(parseDeepLink("not a link").ok).toBe(false);
    expect(parseDeepLink("").ok).toBe(false);
  });

  it("always gives a reason, so a refusal can be shown", () => {
    // A link that silently does nothing is the worst outcome: the user clicked, the app
    // came to the front, and nothing happened — which reads as a broken app.
    const link = parseDeepLink("https://evil.example/run/1");
    expect(link.ok === false && link.reason).toBeTruthy();
  });
});

describe("every route a link reaches is read-only", () => {
  it.each(DEEP_LINK_TARGETS)("routes %s under the dashboard", (target) => {
    const route = routeFor(ok(`kryova://${target}/xyz`));

    expect(route.startsWith("/dashboard/")).toBe(true);
    expect(route.endsWith("/xyz")).toBe(true);
  });

  it("names no verb in any route", () => {
    // The property this list has, and the reason adding a target is a security decision.
    for (const target of DEEP_LINK_TARGETS) {
      const route = routeFor(ok(`kryova://${target}/xyz`));
      expect(route).not.toMatch(/\b(run|start|delete|approve|reject|revoke)\//);
    }
  });
});

describe("opening a local file", () => {
  it("takes the formats the pipeline reads", () => {
    for (const name of ["part.step", "loads.csv", "drawing.PDF", "scan.jpg"]) {
      expect(canOpen({ name, sizeBytes: 1024 }).ok).toBe(true);
    }
  });

  it("refuses an unknown format here rather than after an upload", () => {
    // A local open is instant; a round trip to be told "no" is not.
    const verdict = canOpen({ name: "notes.docx.exe", sizeBytes: 10 });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain(".step");
  });

  it("says so when there is no extension at all", () => {
    expect(canOpen({ name: "README", sizeBytes: 10 }).reason).toContain("no extension");
  });

  it("refuses an empty file", () => {
    expect(canOpen({ name: "a.step", sizeBytes: 0 }).ok).toBe(false);
  });

  it("refuses one over the ceiling and names the ceiling", () => {
    const verdict = canOpen({ name: "huge.step", sizeBytes: MAX_LOCAL_FILE_BYTES + 1 });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("256 MB");
  });

  it("takes one exactly on the ceiling", () => {
    expect(canOpen({ name: "big.step", sizeBytes: MAX_LOCAL_FILE_BYTES }).ok).toBe(true);
  });
});

describe("notifying about a finished run", () => {
  it("says nothing about a short run", () => {
    // A toast for something that finished while the user was still looking at it is
    // noise, and noise is how notifications get switched off — after which the
    // twenty-minute solve they did want is silent too.
    expect(noticeFor("succeeded", NOTIFY_AFTER_SECONDS - 1, "Bracket")).toBeNull();
  });

  it("notifies at the threshold", () => {
    expect(noticeFor("succeeded", NOTIFY_AFTER_SECONDS, "Bracket")).not.toBeNull();
  });

  it("names a failure as a failure", () => {
    // A run that produced no answer must not read like one that did.
    const notice = noticeFor("failed", 300, "Bracket");

    expect(notice?.title).toContain("failed");
    expect(notice?.body).toContain("failed");
  });

  it("keeps a cancellation apart from a failure", () => {
    // A cancellation is the product doing what it was told. `app/core/interruption.py`
    // keeps the same distinction on the server, and grouping them would put a user who
    // changed their mind into the fleet's failure rate.
    const notice = noticeFor("cancelled", 300, "Bracket");

    expect(notice?.title).toContain("stopped");
    expect(notice?.title).not.toContain("failed");
  });

  it("reports the duration in the unit a person would use", () => {
    expect(noticeFor("succeeded", 90, "Bracket")?.body).toContain("2 min");
    expect(noticeFor("succeeded", 61, "Bracket")?.body).toContain("1 min");
  });

  it("names the run, so two notifications are distinguishable", () => {
    expect(noticeFor("succeeded", 300, "Swingarm")?.body).toContain("Swingarm");
  });
});
