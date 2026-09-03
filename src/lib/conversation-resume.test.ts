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
