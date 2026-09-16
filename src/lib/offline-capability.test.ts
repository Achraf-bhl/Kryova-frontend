/**
 * Offline honesty (P7.4): what works without the backend, said rather than discovered.
 *
 * The claims worth holding are the ones that go wrong quietly: an unclassified feature
 * must read as unavailable and not as available; `unknown` at startup must not look like
 * an outage; a 401 must not switch the whole interface off; and "unreachable" and
 * "failing" must not collapse, because the user's next action differs.
 *
 * Written on Linux and not run (the user's rule; Windows runs vitest).
 */

import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  type Reachability,
  UNKNOWN_REACHABILITY,
  allVerdicts,
  bannerFor,
  capability,
  isUsable,
  reachabilityFrom,
  unknownCapability,
  verdictFor,
} from "./offline-capability";

const OFFLINE: Reachability = { state: "unreachable", since: 1000 };
const FAILING: Reachability = { state: "failing", status: 503, since: 1000 };
const ONLINE: Reachability = { state: "online" };

describe("the table is the answer, and a gap in it is not a promise", () => {
  it("treats a capability nobody classified as needing the server", () => {
    // Defaulting to "works offline" would turn forgetting a row into a promise the app
    // cannot keep, which is the failure this module exists to remove.
    const unknown = unknownCapability("something-new");

    expect(unknown.offline).toBe("unavailable");
    expect(verdictFor("something-new", OFFLINE).enabled).toBe(false);
  });

  it("gives every listed capability a sentence saying what to do", () => {
    for (const one of CAPABILITIES) {
      expect(one.whenOffline.length).toBeGreaterThan(20);
      expect(one.label).not.toBe(one.id);
    }
  });

  it("has no duplicate ids, so one feature cannot have two verdicts", () => {
    const ids = CAPABILITIES.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks a known capability up rather than inventing one", () => {
    expect(capability("chat").offline).toBe("unavailable");
    expect(capability("read-handbook").offline).toBe("works");
  });
});

describe("startup is not an outage", () => {
  it("enables everything before the first probe", () => {
    // Greying the interface out on launch would make every cold start look broken.
    for (const one of CAPABILITIES) {
      expect(verdictFor(one.id, UNKNOWN_REACHABILITY).enabled).toBe(true);
    }
    expect(bannerFor(UNKNOWN_REACHABILITY)).toBeNull();
  });

  it("does not call unknown usable", () => {
    // Enabled and usable are different questions: the first is what to let the user try,
    // the second is what the app knows.
    expect(isUsable(UNKNOWN_REACHABILITY)).toBe(false);
    expect(isUsable(ONLINE)).toBe(true);
  });
});

describe("unreachable and failing are different sentences", () => {
  it("says the server cannot be reached when nothing answered", () => {
    const verdict = verdictFor("chat", OFFLINE);

    expect(verdict.reason).toContain("cannot be reached");
    expect(verdict.reason).not.toContain("error (");
  });

  it("says the server answered badly when it did", () => {
    // "No connection" invites checking the network; "the server is having trouble"
    // invites waiting. Swapping them wastes the user's time in both directions.
    const verdict = verdictFor("chat", FAILING);

    expect(verdict.reason).toContain("503");
    expect(verdict.reason).not.toContain("cannot be reached");
  });
});

describe("a cached capability is allowed and marked", () => {
  it("stays enabled but degraded, with a reason", () => {
    const verdict = verdictFor("view-cached-design", OFFLINE);

    expect(verdict.enabled).toBe(true);
    expect(verdict.degraded).toBe(true);
    expect(verdict.reason).toContain("not opened before");
  });

  it("leaves a fully-offline capability undegraded", () => {
    const verdict = verdictFor("read-handbook", OFFLINE);

    expect(verdict.enabled).toBe(true);
    expect(verdict.degraded).toBe(false);
    expect(verdict.reason).toBe("");
  });

  it("never marks anything degraded while online", () => {
    for (const verdict of allVerdicts(ONLINE)) {
      expect(verdict.enabled).toBe(true);
      expect(verdict.degraded).toBe(false);
    }
  });
});

describe("the banner counts rather than adjectives", () => {
  it("says how many features are off and out of how many", () => {
    // "6 of 10 features need the server" is checkable; "limited functionality" is not.
    const banner = bannerFor(OFFLINE);
    const blocked = allVerdicts(OFFLINE).filter((one) => !one.enabled).length;

    expect(banner).toContain(`${blocked} of ${CAPABILITIES.length}`);
  });

  it("shows nothing at all when the backend is fine", () => {
    expect(bannerFor(ONLINE)).toBeNull();
  });

  it("names the status when the server is failing", () => {
    expect(bannerFor(FAILING)).toContain("503");
  });
});

describe("reading a probe", () => {
  it("treats no answer at all as unreachable", () => {
    expect(reachabilityFrom(null, 5).state).toBe("unreachable");
  });

  it("treats 5xx as failing, not as offline", () => {
    const read = reachabilityFrom(503, 5);

    expect(read.state).toBe("failing");
    expect(read.state === "failing" && read.status).toBe(503);
  });

  it("does not call a 401 or a 404 offline", () => {
    // The server is up and answering correctly about something else. Switching the whole
    // interface off because one probe was unauthorised is the obvious wrong reading.
    expect(reachabilityFrom(401, 5).state).toBe("online");
    expect(reachabilityFrom(404, 5).state).toBe("online");
    expect(reachabilityFrom(200, 5).state).toBe("online");
  });

  it("uses navigator.onLine as a fast negative only", () => {
    // `onLine === true` on a captive-portal wifi reaches nothing, so it proves nothing and
    // the probe still decides. `false` is conclusive.
    expect(reachabilityFrom(200, 5, false).state).toBe("unreachable");
    expect(reachabilityFrom(200, 5, true).state).toBe("online");
    expect(reachabilityFrom(null, 5, true).state).toBe("unreachable");
  });

  it("records when the trouble started, for a banner that can age", () => {
    const read = reachabilityFrom(null, 1234);

    expect(read.state === "unreachable" && read.since).toBe(1234);
  });
});

describe("nothing is queued for later", () => {
  it("tells the user a refused action is not being held", () => {
    // An offline queue is a real feature with real consequences (an edit replayed against
    // a part that moved underneath). Pretending to accept a write is worse than refusing.
    for (const id of ["edit-design", "run-simulation", "upload-attachment"]) {
      const verdict = verdictFor(id, OFFLINE);
      expect(verdict.enabled).toBe(false);
      expect(verdict.reason.toLowerCase()).toMatch(/again|not held|nothing is held/);
    }
  });
});
