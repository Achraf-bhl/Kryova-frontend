import Link from "next/link";

import { BranchIcon, EditIcon, RetryIcon } from "@/components/ui/icons";
import type { BranchedFrom } from "@/types/conversation";

const ACTION =
  "inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs text-muted transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50";

export interface RewindActionsProps {
  disabled: boolean;
  onRetry: () => void;
  onEdit: () => void;
}

/**
 * Retry and Edit, under the newest message the person wrote (ROAD_TO_10 2.5).
 *
 * Both take the message back first — the server deletes it and everything after —
 * and differ only in what happens to the text: Retry sends it again at once, Edit
 * puts it in the composer. Always in the DOM and revealed on hover or focus, the
 * way the Copy button is, so a keyboard and a screen reader reach them.
 */
export function RewindActions({ disabled, onRetry, onEdit }: RewindActionsProps) {
  return (
    <div className="flex justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button type="button" onClick={onRetry} disabled={disabled} className={ACTION}>
        <RetryIcon className="size-3.5" />
        Retry
      </button>
      <button type="button" onClick={onEdit} disabled={disabled} className={ACTION}>
        <EditIcon className="size-3.5" />
        Edit
      </button>
    </div>
  );
}

export interface BranchButtonProps {
  disabled: boolean;
  onBranch: () => void;
}

/** Start a new conversation from this answer, leaving this one as it is. */
export function BranchButton({ disabled, onBranch }: BranchButtonProps) {
  return (
    <button
      type="button"
      onClick={onBranch}
      disabled={disabled}
      className={ACTION}
      aria-label="Branch a new conversation from this answer"
    >
      <BranchIcon className="size-3.5" />
      Branch
    </button>
  );
}

export interface RewindRefusalProps {
  reason: string;
  /** Whether there is an earlier answer to branch from instead. */
  canBranch: boolean;
  onBranch: () => void;
  onDismiss: () => void;
}

/**
 * Why a message could not be taken back, in the server's words.
 *
 * The refusal is a decision with a remedy, not an error: a turn that changed the
 * part cannot be undone by deleting the messages that describe it. When there is
 * an earlier answer, the remedy is one click here instead of a sentence to act on.
 */
export function RewindRefusal({ reason, canBranch, onBranch, onDismiss }: RewindRefusalProps) {
  return (
    <div
      role="alert"
      className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-muted"
    >
      <p>{reason}</p>
      <div className="mt-1.5 flex gap-3">
        {canBranch && (
          <button
            type="button"
            onClick={onBranch}
            className="font-medium text-accent underline underline-offset-2 hover:no-underline"
          >
            Branch from the answer before it
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="underline underline-offset-2 hover:text-accent hover:no-underline"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export interface BranchNoticeProps {
  from: BranchedFrom | null | undefined;
  /** A document is bound to this conversation, so the first-build caveat has ended. */
  hasDocument: boolean;
}

/**
 * Said at the head of a branch, so the person knows what it did not bring.
 *
 * The transcript above describes a CATIA part that lives in the *other*
 * conversation's document — a document belongs to one conversation. The model is
 * told the same thing in its state block until this conversation has a document
 * of its own, and the notice goes away at the same moment for the same reason: it
 * stops being true.
 */
export function BranchNotice({ from, hasDocument }: BranchNoticeProps) {
  if (!from) return null;
  return (
    <aside
      aria-label="Where this conversation was branched from"
      className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3 text-xs text-muted"
    >
      <p className="flex items-center gap-2">
        <BranchIcon className="size-3.5 shrink-0" />
        <span>
          Branched from{" "}
          <Link
            href={`/dashboard/c/${from.conversation_id}`}
            className="font-medium text-accent underline underline-offset-2 hover:no-underline"
          >
            {from.title}
          </Link>
          .
        </span>
      </p>
      {!hasDocument && (
        <p className="mt-1.5">
          The CATIA part was not copied: it belongs to the original. The first build here starts a
          new part, and the agent has been told the same.
        </p>
      )}
    </aside>
  );
}
