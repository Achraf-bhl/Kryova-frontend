import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  availability,
  explain,
  isDown,
  stateFromProbe,
  summarise,
  type BackendState,
} from "./offline-capability";

/**
 * P7 task 4, tested as the table it is.
 *
 * This module and these tests were claimed by the master plan on 2026-09-16 and had never
 * been committed — one of ten such paths found by the audit of 2026-09-17. The design
 * survived in the status that claimed it, and each test below names the failure the
 * design is avoiding, because a design described in prose and never executed is what
 * produced the false claim in the first place.
 */

const DOWN: BackendState[] = ["unreachable", "failing"];

describe("the table is the whole answer", () => {
  it("lists ten capabilities", () => {
    expect(CAPABILITIES).toHaveLength(10);
  });

  it("gives every capability a reason, not just a verdict", () => {
    // A disabled control with no sentence is a control the user presses again.
    for (const capability of CAPABILITIES) {
      expect(capability.because.length).toBeGreaterThan(10);
      expect(capability.label.length).toBeGreaterThan(3);
    }
  });

  it("has no duplicate ids", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("treats a capability it does not list as unavailable", () => {
    // The point of the module. Defaulting a missing row to "works offline" turns
    // forgetting to add one into a promise the app cannot keep.
    for (const state of [...DOWN, "online", "unknown"] as BackendState[]) {
      expect(availability("something-nobody-added", state)).toBe("unavailable");
    }
  });

  it("explains an unknown capability rather than throwing", () => {
    // A missing row must not be able to take a screen down.
    expect(explain("not-a-thing", "online")).toContain("switched off");
  });
});

describe("unknown is not offline", () => {
  it("is not treated as down", () => {
    // Before the first probe the honest position is that the backend is probably fine.
    // Greying the interface out on launch makes every cold start look like an outage.
    expect(isDown("unknown")).toBe(false);
  });

  it("leaves every capability available", () => {
    for (const capability of CAPABILITIES) {
      expect(availability(capability.id, "unknown")).toBe("available");
    }
  });

  it("shows no banner", () => {
    expect(summarise("unknown").banner).toBeNull();
  });
});

describe("what each requirement does when the backend is down", () => {
  it.each(DOWN)("a server capability is unavailable when %s", (state) => {
    expect(availability("run-simulation", state)).toBe("unavailable");
  });

  it.each(DOWN)("a cache capability is degraded, not unavailable, when %s", (state) => {
    // Enabled *and* marked: a short list must not read as the whole list.
    expect(availability("view-cached-design", state)).toBe("degraded");
  });

  it.each(DOWN)("a capability needing nothing stays available when %s", (state) => {
    expect(availability("read-docs", state)).toBe("available");
  });

  it("everything is available when the backend answers", () => {
    for (const capability of CAPABILITIES) {
      expect(availability(capability.id, "online")).toBe("available");
    }
  });
});

describe("unreachable and failing get different sentences", () => {
  it("points at the connection when nothing answered", () => {
    // "No connection" invites checking the network.
    expect(explain("run-simulation", "unreachable")).toContain("connection");
  });

  it("points at waiting when the server is erroring", () => {
    // "The server is having trouble" invites waiting. Swapping the two wastes the
    // user's time in both directions.
    const sentence = explain("run-simulation", "failing") ?? "";
    expect(sentence).toContain("trouble");
    expect(sentence).toContain("Waiting");
  });

  it("says nothing is queued, on every refusal", () => {
    // An offline queue is a real feature with real consequences; pretending to accept a
    // write is worse than refusing it.
    for (const state of DOWN) {
      expect(explain("edit-parameter", state)).toContain("queued");
    }
  });

  it("explains nothing when the capability is fully available", () => {
    expect(explain("run-simulation", "online")).toBeNull();
    expect(explain("read-docs", "unreachable")).toBeNull();
  });
});

describe("reading a probe", () => {
  it("is unreachable when nothing answered", () => {
    expect(stateFromProbe(null)).toBe("unreachable");
  });

  it("is failing only on a 5xx", () => {
    expect(stateFromProbe(500)).toBe("failing");
    expect(stateFromProbe(503)).toBe("failing");
  });

  it("does not call a 401 or a 404 offline", () => {
    // The server is up and answering correctly about something else. Switching the whole
    // interface off because one probe was unauthorised is the obvious wrong reading.
    expect(stateFromProbe(401)).toBe("online");
    expect(stateFromProbe(404)).toBe("online");
    expect(stateFromProbe(200)).toBe("online");
  });

  it("takes navigator.onLine as a negative only", () => {
    // False means definitely offline; true means nothing, because a captive portal is
    // `true` and reaches nothing — so a 200 is what decides "fine".
    expect(stateFromProbe(200, false)).toBe("unreachable");
    expect(stateFromProbe(200, true)).toBe("online");
  });
});

describe("the banner counts rather than using adjectives", () => {
  it("says how many of how many", () => {
    // "7 of 10 features need the server" is checkable; "limited functionality" is not.
    const summary = summarise("unreachable");

    expect(summary.banner).toContain(`${summary.unavailable} of ${summary.total}`);
    expect(summary.banner).not.toMatch(/limited|reduced|some features/i);
  });

  it("counts seven unavailable and two degraded of ten", () => {
    const summary = summarise("unreachable");

    expect(summary.total).toBe(10);
    expect(summary.unavailable).toBe(7);
    expect(summary.degraded).toBe(2);
  });

  it("mentions the cached ones separately rather than lumping them in", () => {
    expect(summarise("failing").banner).toContain("cached");
  });

  it("has no banner when the backend is fine", () => {
    expect(summarise("online").banner).toBeNull();
  });

  it("opens differently for unreachable and failing", () => {
    expect(summarise("unreachable").banner).toContain("No connection");
    expect(summarise("failing").banner).toContain("having trouble");
  });
});
