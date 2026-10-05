import { describe, expect, it } from "vitest";

import type { ActivityEntry } from "@/types/api";

import { actorLabel, groupByDay, mergePages, parseTagInput } from "./activity-feed";

function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    at: "2026-10-05T10:00:00",
    kind: "design.revision",
    summary: "Changed a thing.",
    actor_kind: "user",
    actor_user_id: "u1",
    actor_email: "ada@shop.dev",
    target_type: "design_document",
    target_id: "d1",
    ...over,
  };
}

describe("who the feed says did it", () => {
  it("says You for the reader's own change", () => {
    expect(actorLabel(entry(), "u1")).toBe("You");
  });

  it("names a colleague by the address the server gave", () => {
    expect(actorLabel(entry(), "u2")).toBe("ada@shop.dev");
  });

  it("never calls the agent You", () => {
    expect(actorLabel(entry({ actor_kind: "agent", actor_user_id: null }), "u1")).toBe("The agent");
  });

  it("does not credit a row that records no author to anyone", () => {
    const unknown = entry({ actor_kind: "unknown", actor_user_id: null, actor_email: null });
    expect(actorLabel(unknown, "u1")).toBe("Someone");
    expect(actorLabel(unknown, null)).toBe("Someone");
  });

  it("falls back when a user entry carries no address", () => {
    expect(actorLabel(entry({ actor_email: null }), "u2")).toBe("A colleague");
  });
});

describe("grouping by day", () => {
  const now = new Date(2026, 9, 5, 15, 0, 0);

  it("labels today and yesterday, and groups in the order given", () => {
    const days = groupByDay(
      [
        entry({ at: new Date(2026, 9, 5, 9, 0).toISOString() }),
        entry({ at: new Date(2026, 9, 5, 8, 0).toISOString() }),
        entry({ at: new Date(2026, 9, 4, 23, 0).toISOString() }),
        entry({ at: new Date(2026, 8, 1, 12, 0).toISOString() }),
      ],
      now,
    );
    expect(days.map((d) => d.label).slice(0, 2)).toEqual(["Today", "Yesterday"]);
    expect(days[0].entries).toHaveLength(2);
    expect(days).toHaveLength(3);
  });

  it("skips an entry whose time cannot be read rather than throwing", () => {
    expect(groupByDay([entry({ at: "not a date" })], now)).toEqual([]);
  });
});

describe("paging", () => {
  it("does not repeat an entry a page boundary delivered twice", () => {
    const a = entry({ target_id: "a", at: "2026-10-05T10:00:00" });
    const b = entry({ target_id: "b", at: "2026-10-05T09:00:00" });
    expect(mergePages([a], [a, b])).toEqual([a, b]);
  });
});

describe("the tag field", () => {
  it("splits on commas and drops blanks", () => {
    expect(parseTagInput(" press, frame ,, m8 bolts ,")).toEqual(["press", "frame", "m8 bolts"]);
    expect(parseTagInput("")).toEqual([]);
  });
});
