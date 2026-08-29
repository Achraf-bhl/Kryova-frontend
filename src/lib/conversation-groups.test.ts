import { describe, expect, it } from "vitest";

import { bucketFor, groupConversations } from "@/lib/conversation-groups";
import type { ConversationSummary } from "@/types/conversation";

function conversation(id: string, updatedAt: string): ConversationSummary {
  return {
    conversation_id: id,
    title: id,
    project_id: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    message_count: 2,
    has_catia_document: false,
    prompt_tokens: 0,
    completion_tokens: 0,
  };
}

/** Local time, so the assertions match the local-midnight boundaries used. */
function local(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

const now = new Date(2026, 7, 29, 10, 0); // 29 Aug 2026, 10:00 local

describe("bucketFor", () => {
  it("files this calendar day under Today", () => {
    expect(bucketFor(local(2026, 8, 29, 0, 1), now)).toBe("Today");
    expect(bucketFor(local(2026, 8, 29, 23, 59), now)).toBe("Today");
  });

  it("splits Yesterday from Today at midnight, not at 24 elapsed hours", () => {
    // 90 minutes apart, but either side of midnight.
    expect(bucketFor(local(2026, 8, 28, 23, 30), now)).toBe("Yesterday");
    expect(bucketFor(local(2026, 8, 29, 0, 30), now)).toBe("Today");
  });

  it("covers days 2-7 with Previous 7 days and older with Older", () => {
    expect(bucketFor(local(2026, 8, 27), now)).toBe("Previous 7 days");
    expect(bucketFor(local(2026, 8, 22), now)).toBe("Previous 7 days");
    expect(bucketFor(local(2026, 8, 21), now)).toBe("Older");
  });

  it("treats a future timestamp as Today rather than filing it under Older", () => {
    expect(bucketFor(local(2026, 8, 30), now)).toBe("Today");
  });

  it("does not throw on an unparseable timestamp", () => {
    expect(bucketFor("not a date", now)).toBe("Older");
  });
});

describe("groupConversations", () => {
  it("returns groups in fixed order, newest conversation first inside each", () => {
    const groups = groupConversations(
      [
        conversation("old", local(2026, 8, 1)),
        conversation("today-early", local(2026, 8, 29, 8)),
        conversation("today-late", local(2026, 8, 29, 9, 30)),
        conversation("yesterday", local(2026, 8, 28)),
      ],
      now,
    );

    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Older"]);
    expect(groups[0].items.map((item) => item.conversation_id)).toEqual([
      "today-late",
      "today-early",
    ]);
  });

  it("omits empty groups entirely", () => {
    const groups = groupConversations([conversation("a", local(2026, 8, 29))], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
  });

  it("returns nothing for an empty list", () => {
    expect(groupConversations([], now)).toEqual([]);
  });

  it("does not mutate the array it is given", () => {
    const input = [conversation("a", local(2026, 8, 1)), conversation("b", local(2026, 8, 29))];
    groupConversations(input, now);
    expect(input.map((item) => item.conversation_id)).toEqual(["a", "b"]);
  });
});
