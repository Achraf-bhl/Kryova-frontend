import { describe, expect, it } from "vitest";

import { RESUME_GAP_MS, resumeNotice } from "@/lib/conversation-resume";
import type { ConversationResume } from "@/types/conversation";

const NOW = Date.parse("2026-09-03T12:00:00Z");

function resume(over: Partial<ConversationResume> = {}): ConversationResume {
  return {
    operations: 12,
    last_activity_at: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(),
    unfinished: [],
    ...over,
  };
}

describe("resumeNotice", () => {
  it("says nothing about a conversation that never touched CATIA", () => {
    // Most conversations. A banner on all of them is furniture.
    expect(resumeNotice(resume({ operations: 0 }), NOW)).toBeNull();
  });

  it("says nothing when the reader never left", () => {
    // Sending a second message is not a return, and the transcript above
    // already reads as continuous.
    const recent = new Date(NOW - RESUME_GAP_MS / 2).toISOString();
    expect(resumeNotice(resume({ last_activity_at: recent }), NOW)).toBeNull();
  });

  it("names the gap and the volume of work when time has passed", () => {
    const notice = resumeNotice(resume(), NOW);
    expect(notice?.headline).toBe("Picked up 3 days later — 12 CATIA operations so far");
  });

  it("counts one operation without the plural", () => {
    const notice = resumeNotice(resume({ operations: 1 }), NOW);
    expect(notice?.headline).toContain("1 CATIA operation so far");
  });

  it.each([
    [90 * 60 * 1000, "1 hour"],
    [5 * 60 * 60 * 1000, "5 hours"],
    [26 * 60 * 60 * 1000, "1 day"],
  ])("describes a %d ms gap as %s", (elapsed, expected) => {
    const at = new Date(NOW - elapsed).toISOString();
    expect(resumeNotice(resume({ last_activity_at: at }), NOW)?.headline).toContain(expected);
  });

  it("surfaces loose ends even in the same sitting", () => {
    // The one thing neither the part on screen nor the transcript reliably
    // shows: a feature that failed to build is a feature that is not there.
    const notice = resumeNotice(
      resume({
        last_activity_at: new Date(NOW - 1000).toISOString(),
        unfinished: [
          { tool: "catia_hole", label: "CATIA: hole", error: "breaks the wall", attempts: 2 },
        ],
      }),
      NOW,
    );

    expect(notice).not.toBeNull();
    expect(notice?.headline).toBe("12 CATIA operations so far");
    expect(notice?.unfinished).toHaveLength(1);
  });

  it("does not read a missing timestamp as just now", () => {
    // Null must mean "cannot say". Treating it as zero elapsed would suppress
    // the notice on exactly the conversations whose record is thinnest.
    const notice = resumeNotice(
      resume({
        last_activity_at: null,
        unfinished: [{ tool: "catia_pad", label: "CATIA: pad", error: "no sketch", attempts: 1 }],
      }),
      NOW,
    );

    expect(notice?.headline).toBe("12 CATIA operations so far");
  });

  it("does not render a negative gap when the clocks disagree", () => {
    const ahead = new Date(NOW + 60 * 60 * 1000).toISOString();
    const notice = resumeNotice(
      resume({
        last_activity_at: ahead,
        unfinished: [{ tool: "catia_pad", label: "CATIA: pad", error: "no sketch", attempts: 1 }],
      }),
      NOW,
    );

    expect(notice?.headline).not.toContain("-");
  });

  it("tolerates an unparseable timestamp rather than throwing", () => {
    const notice = resumeNotice(resume({ last_activity_at: "not a date" }), NOW);
    expect(notice).toBeNull();
  });

  it("tolerates an absent resume payload", () => {
    // An older backend, or the chat home where there is no conversation yet.
    expect(resumeNotice(null, NOW)).toBeNull();
    expect(resumeNotice(undefined, NOW)).toBeNull();
  });
});

describe("resumeNotice reads the plan and the design the server holds (2.3)", () => {
  const PLAN = {
    total: 5,
    settled: 2,
    open: [
      { id: "t3", title: "Add the fillets", state: "pending" },
      { id: "t4", title: "Run the stress study", state: "pending" },
      { id: "t5", title: "Write the drawing", state: "pending" },
    ],
    next: { id: "t3", title: "Add the fillets" },
  };
  const recent = new Date(NOW - RESUME_GAP_MS / 2).toISOString();

  it("speaks up in the same sitting when the plan has work left", () => {
    // Without this the only trace of a task the agent declared and never
    // reached is in no message at all.
    const notice = resumeNotice(resume({ last_activity_at: recent, plan: PLAN }), NOW);
    expect(notice?.plan).toBe("Plan: 2 of 5 tasks done — next: Add the fillets");
  });

  it("stays quiet about a plan that is finished", () => {
    const done = { total: 3, settled: 3, open: [], next: null };
    expect(resumeNotice(resume({ last_activity_at: recent, plan: done }), NOW)).toBeNull();
  });

  it("says so when everything left is blocked rather than naming a next task", () => {
    const stuck = { ...PLAN, next: null };
    const notice = resumeNotice(resume({ last_activity_at: recent, plan: stuck }), NOW);
    expect(notice?.plan).toContain("nothing is ready");
  });

  it("speaks for a plan even when CATIA was never touched", () => {
    const notice = resumeNotice(
      resume({ operations: 0, last_activity_at: null, plan: PLAN }),
      NOW,
    );
    expect(notice?.headline).toBe("A plan with work left");
    expect(notice?.plan).toContain("2 of 5");
  });

  it("names the design by revision beside the work done", () => {
    const notice = resumeNotice(
      resume({ design: { name: "bracket", revision: 7, parameters: 4 } }),
      NOW,
    );
    expect(notice?.design).toBe("Design: bracket, revision 7");
  });

  it("does not let a design alone make a banner for a reader who never left", () => {
    expect(
      resumeNotice(
        resume({ last_activity_at: recent, design: { name: "bracket", revision: 7, parameters: 4 } }),
        NOW,
      ),
    ).toBeNull();
  });

  it("uses the singular for a one-task plan", () => {
    const one = {
      total: 1,
      settled: 0,
      open: [{ id: "t1", title: "Build it", state: "pending" }],
      next: { id: "t1", title: "Build it" },
    };
    const notice = resumeNotice(resume({ last_activity_at: recent, plan: one }), NOW);
    expect(notice?.plan).toBe("Plan: 0 of 1 task done — next: Build it");
  });
});

