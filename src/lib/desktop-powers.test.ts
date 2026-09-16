/**
 * The desktop-only powers (P7.3), and mostly the one that is a security boundary.
 *
 * A `kryova://` link arrives from an email or a CI comment, the person clicking it cannot
 * read it first, and the app it opens is already signed in. `parseDeepLink` is therefore
 * an allow-list of shapes, and these tests are mostly about what it refuses.
 *
 * Every URL-parsing claim below was checked against node's WHATWG `URL` on 2026-09-16
 * before it was written here — in particular that `kryova://run/x` and `kryova:/run/x`
 * parse differently, and that `%2e%2e%2f` survives in `pathname` un-decoded.
 *
 * Written on Linux and not run (the user's rule; Windows runs vitest).
 */

import { describe, expect, it } from "vitest";

import {
  MAX_FILE_BYTES,
  OPENABLE_EXTENSIONS,
  WORTH_INTERRUPTING_MS,
  notificationFor,
  openable,
  parseDeepLink,
  refusalMessage,
} from "./desktop-powers";

/**
 * The refusal, or `null` when the link was accepted.
 *
 * A helper rather than a cast: `DeepLinkResult` is a discriminated union on purpose, and
 * casting past it in the tests would mean the tests stop checking the shape the callers
 * have to handle.
 */
function refusalOf(result: ReturnType<typeof parseDeepLink>): string | null {
  return result.ok ? null : result.refusal;
}

describe("a deep link is an allow-list, not a filter", () => {
  it("opens the three targets it knows", () => {
    expect(parseDeepLink("kryova://run/sim-1")).toEqual({
      ok: true,
      target: { kind: "run", simulationId: "sim-1" },
      path: "/dashboard/simulations/sim-1",
    });
    expect(parseDeepLink("kryova://conversation/c1").ok).toBe(true);
    expect(parseDeepLink("kryova://project/p1").ok).toBe(true);
  });

  it("accepts both spellings an email client may produce", () => {
    // `kryova://run/x` parses with host "run"; `kryova:/run/x` with an empty host and
    // pathname "/run/x". Reading segments from either alone misses the other.
    const withHost = parseDeepLink("kryova://run/sim-1");
    const withoutHost = parseDeepLink("kryova:/run/sim-1");

    expect(withHost).toEqual(withoutHost);
  });

  it("refuses every other scheme", () => {
    for (const bad of [
      "https://evil.example/run/abc",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>",
      "not a url at all",
    ]) {
      expect(parseDeepLink(bad)).toEqual({
        ok: false,
        refusal: "not-a-kryova-link",
      });
    }
  });

  it("refuses a target it does not know rather than routing to it", () => {
    // The point of an allow-list: a version that learns a new target learns it here,
    // deliberately, rather than by a link teaching it one.
    expect(refusalOf(parseDeepLink("kryova://admin/1"))).toBe("unknown-target");
    expect(refusalOf(parseDeepLink("kryova://settings/tokens"))).toBe("unknown-target");
    expect(refusalOf(parseDeepLink("kryova://"))).toBe("unknown-target");
  });

  it("refuses a link carrying more than one item", () => {
    expect(refusalOf(parseDeepLink("kryova://run/abc/extra"))).toBe("extra-path");
  });

  it("refuses a target with no id", () => {
    expect(refusalOf(parseDeepLink("kryova://run"))).toBe("malformed-id");
  });

  it("decodes before it validates, so %2e%2e%2f cannot slip past", () => {
    // `URL` leaves `%2e%2e%2f` encoded in `pathname` (checked on node), so a check run
    // before decoding sees a harmless-looking token and the app navigates to `../`.
    expect(refusalOf(parseDeepLink("kryova://run/%2e%2e%2fadmin"))).toBe("malformed-id");
    expect(refusalOf(parseDeepLink("kryova://run/a%20b"))).toBe("malformed-id");
    expect(refusalOf(parseDeepLink("kryova://run/a%2Fb"))).toBe("malformed-id");
  });

  it("refuses an id with anything that could be a path, query or fragment", () => {
    for (const bad of ["kryova://run/a/b", "kryova://run/a.b", "kryova://run/a:b"]) {
      expect(parseDeepLink(bad).ok).toBe(false);
    }
  });

  it("refuses an id long enough to be something else", () => {
    expect(refusalOf(parseDeepLink(`kryova://run/${"a".repeat(65)}`))).toBe("malformed-id");
    expect(parseDeepLink(`kryova://run/${"a".repeat(64)}`).ok).toBe(true);
  });

  it("gives every refusal a sentence that does not blame the user", () => {
    for (const refusal of [
      "not-a-kryova-link",
      "unknown-target",
      "malformed-id",
      "extra-path",
    ] as const) {
      expect(refusalMessage(refusal).length).toBeGreaterThan(20);
    }
  });

  it("never lands anywhere but a read page under /dashboard", () => {
    // Nothing a link reaches may perform an action: a link that ran a simulation or
    // accepted an invitation would be a one-click cross-site request against a session
    // that is already open.
    for (const good of [
      "kryova://run/a",
      "kryova://conversation/b",
      "kryova://project/c",
    ]) {
      const result = parseDeepLink(good);
      expect(result.ok && result.path.startsWith("/dashboard/")).toBe(true);
    }
  });
});

describe("a notification is for someone who walked away", () => {
  const run = {
    id: "s1",
    label: "Bracket, linear static",
    status: "succeeded" as const,
    elapsedMs: 120_000,
  };

  it("notifies when the run was long and the window is not focused", () => {
    const decision = notificationFor(run, false);

    expect(decision.notify).toBe(true);
    expect(decision.title).toBe("Simulation finished");
    expect(decision.body).toContain("Bracket, linear static");
  });

  it("stays quiet when the user is looking at it", () => {
    expect(notificationFor(run, true).notify).toBe(false);
  });

  it("stays quiet for a run nobody walked away from", () => {
    // Noise gets an app's notifications switched off at the OS level, after which the
    // one that mattered never arrives either.
    const quick = { ...run, elapsedMs: WORTH_INTERRUPTING_MS - 1 };

    expect(notificationFor(quick, false).notify).toBe(false);
  });

  it("never notifies a cancellation", () => {
    // The user did it themselves, seconds ago, deliberately.
    const cancelled = { ...run, status: "cancelled" as const };

    expect(notificationFor(cancelled, false).notify).toBe(false);
    expect(notificationFor(cancelled, false).skipped).toContain("themselves");
  });

  it("says a failure failed rather than dressing it up", () => {
    const failed = notificationFor({ ...run, status: "failed" }, false);

    expect(failed.notify).toBe(true);
    expect(failed.title).toBe("Simulation failed");
    expect(failed.body).toContain("did not finish");
  });

  it("puts no result number in the body", () => {
    // A stress figure with no mesh, material or load case beside it is the unqualified
    // number `app/verify/` exists to prevent, and a notification has no room for the
    // qualification.
    const decision = notificationFor(run, false);

    expect(decision.body).not.toMatch(/\d+(\.\d+)?\s*(MPa|mm|kg)/);
  });
});

describe("opening a local file", () => {
  it("accepts a CAD file from a Windows path", () => {
    const verdict = openable({ path: "C:\\parts\\bracket.STEP", bytes: 4096 });

    expect(verdict).toEqual({ ok: true, name: "bracket.STEP", extension: "step" });
  });

  it("accepts a posix path too", () => {
    expect(openable({ path: "/home/a/b/part.stp", bytes: 10 }).ok).toBe(true);
  });

  it("refuses a type the pipeline does not read, naming it", () => {
    const verdict = openable({ path: "C:\\x\\notes.exe", bytes: 10 });

    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.refusal).toBe("unsupported-type");
    expect(verdict.ok === false && verdict.message).toContain(".exe");
  });

  it("refuses a file with no extension, and a dotfile is not an extension", () => {
    expect(openable({ path: "/home/a/README", bytes: 10 }).ok).toBe(false);
    expect(openable({ path: "/home/a/.bashrc", bytes: 10 }).ok).toBe(false);
  });

  it("refuses an empty file and an oversized one", () => {
    expect(openable({ path: "a.step", bytes: 0 }).ok).toBe(false);
    expect(openable({ path: "a.step", bytes: MAX_FILE_BYTES + 1 }).ok).toBe(false);
    expect(openable({ path: "a.step", bytes: MAX_FILE_BYTES }).ok).toBe(true);
  });

  it("accepts the same set the browser upload does", () => {
    // A file that opens on the desktop and is refused in the browser is a product that
    // behaves differently depending on how it was opened.
    expect(OPENABLE_EXTENSIONS).toContain("step");
    expect(OPENABLE_EXTENSIONS).toContain("xlsx");
    expect(OPENABLE_EXTENSIONS).toContain("kreq");
    expect(OPENABLE_EXTENSIONS).not.toContain("exe");
  });
});
