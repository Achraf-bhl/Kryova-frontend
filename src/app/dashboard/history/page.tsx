import Link from "next/link";

import { PageShell } from "@/components/ui/page-shell";
import { groupConversations } from "@/lib/conversation-groups";
import { fetchConversationPage } from "@/lib/server-api";

export const dynamic = "force-dynamic";

/** The full conversation history, in the same buckets the sidebar uses. */
export default async function HistoryPage() {
  const page = await fetchConversationPage({ page: 1, pageSize: 100 });
  const groups = groupConversations(page.items);

  return (
    <PageShell className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">History</h1>
        <p className="mt-1 text-sm text-muted">
          {page.total === 0
            ? "Nothing here yet."
            : `${page.total} conversation${page.total === 1 ? "" : "s"}. A filled dot means the chat owns a CATIA document — reopening it reopens the part.`}
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="k-panel p-8 text-center">
          <p className="text-sm text-muted">
            Every chat you start is kept, with its transcript and its CATIA document.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Start one
          </Link>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-2 text-[0.6875rem] font-medium uppercase tracking-wider text-faint">
              {group.label}
            </h2>
            <ul className="k-panel divide-y divide-border">
              {group.items.map((conversation) => (
                <li key={conversation.conversation_id}>
                  <Link
                    href={`/dashboard/c/${conversation.conversation_id}`}
                    className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-primary-soft/50"
                  >
                    <span
                      className="k-conv-dot"
                      data-bound={conversation.has_catia_document ? "true" : "false"}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-accent">
                      {conversation.title}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-faint">
                      {conversation.message_count} msg
                    </span>
                    <time
                      className="hidden shrink-0 font-mono text-xs text-faint sm:block"
                      dateTime={conversation.updated_at}
                    >
                      {new Date(conversation.updated_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </PageShell>
  );
}
