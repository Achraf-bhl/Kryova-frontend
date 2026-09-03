import { HistoryIcon } from "@/components/ui/icons";
import type { ResumeNotice as Notice } from "@/lib/conversation-resume";

export interface ResumeNoticeProps {
  notice: Notice | null;
}

/**
 * Where the work got to, shown once at the top of a reopened conversation.
 *
 * The transcript below is a record of what was *said*. This is a record of what
 * was *done* — read from the backend's log of the CATIA calls, which is the
 * same source the agent's own state block reads. So the person and the model
 * come back to one account of the session rather than two.
 *
 * The loose ends are the reason it exists. A feature that failed to build is
 * not visible in the part, because it is not in the part; the only trace is a
 * tool error somewhere up a transcript nobody scrolls. Naming it here is what
 * stops a resumed session quietly dropping something the user still wanted.
 *
 * Deliberately not a dismissible alert and not coloured as a warning. Nothing
 * here is wrong yet — it is context, and it stops being shown by itself as soon
 * as the loose ends are dealt with.
 */
export function ResumeNotice({ notice }: ResumeNoticeProps) {
  if (!notice) return null;

  return (
    <aside
      aria-label="Where this conversation got to"
      className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3 text-xs"
    >
      <p className="flex items-center gap-2 text-muted">
        <HistoryIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{notice.headline}</span>
      </p>

      {notice.unfinished.length > 0 && (
        <>
          <p className="mt-2.5 font-medium text-accent">
            {notice.unfinished.length === 1
              ? "One step never completed"
              : `${notice.unfinished.length} steps never completed`}
          </p>
          <ul className="mt-1 space-y-1">
            {notice.unfinished.map((item) => (
              <li key={item.tool} className="text-muted">
                <span className="text-accent">{item.label}</span>
                {item.attempts > 1 && ` (${item.attempts} attempts)`}
                {" — "}
                {item.error}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
