"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import {
  allowanceNotice,
  describeConversation,
  describeRemaining,
} from "@/lib/usage-meter";
import type { ConversationUsage } from "@/types/api";

/**
 * The running cost of this conversation, today's allowance left, and a warning from 80 %
 * (ROAD_TO_10 8.1). All text comes from `lib/usage-meter.ts`; the numbers are the server's
 * ledger sums, handed in from the stream's `usage` event or fetched once on opening an
 * existing conversation. Nothing here adds anything up.
 *
 * Renders nothing until the server has said something: a "$0" shown before the first
 * answer would be a guess about a bill that has not been read yet.
 */
export function UsageMeter({
  conversationId,
  live,
}: {
  conversationId: string | null;
  live: ConversationUsage | null;
}) {
  const [fetched, setFetched] = useState<{ id: string; usage: ConversationUsage } | null>(null);

  useEffect(() => {
    if (!conversationId || live) return;
    let cancelled = false;
    api
      .conversationUsage(conversationId)
      .then((usage) => {
        if (!cancelled) setFetched({ id: conversationId, usage });
      })
      .catch(() => {
        // A meter that cannot be read is absent, not an error banner on a chat.
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, live]);

  const usage = live ?? (fetched && fetched.id === conversationId ? fetched.usage : null);
  if (!usage) return null;

  const notice = allowanceNotice(usage.allowance);
  const remaining = describeRemaining(usage.today, usage.allowance);
  const tone =
    notice.level === "exhausted"
      ? "text-danger"
      : notice.level === "warning"
        ? "text-warning"
        : "text-faint";

  return (
    <div className="px-1 pt-1 text-xs" data-testid="usage-meter">
      <p className="text-faint">
        {describeConversation(usage.conversation)}
        {remaining ? ` · ${remaining}` : ""}
      </p>
      {notice.text && (
        <p role="status" className={tone}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
