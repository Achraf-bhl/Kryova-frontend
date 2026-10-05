"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BranchIcon, CheckIcon, CloseIcon, PinIcon, TrashIcon } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import type { ConversationSummary } from "@/types/conversation";

export interface ConversationRowProps {
  conversation: ConversationSummary;
  active: boolean;
  onDeleted: (conversationId: string) => void;
  onRenamed: (conversationId: string, title: string) => void;
  /** Called once the server has kept the pin, so the row moves only when it is true. */
  onPinned: (conversationId: string, pinned: boolean) => void;
  /** Called after a pin the server kept, so the list can re-read the order it chose. */
  onPinSettled: () => void;
}

/**
 * One conversation in the sidebar.
 *
 * The dot is load-bearing: filled means a CATIA document is bound to this chat,
 * so opening it reopens that part in CATIA. Hollow means the chat is analysis
 * only. That is the difference between "click here to pick the bracket back up"
 * and "click here to re-read an answer", and the user needs it before they
 * click, not after.
 */
export function ConversationRow({
  conversation,
  active,
  onDeleted,
  onRenamed,
  onPinned,
  onPinSettled,
}: ConversationRowProps) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);

  const id = conversation.conversation_id;

  // The row's own buttons are replaced when the delete confirmation opens, and a focused
  // element that unmounts drops focus to <body> — which also ends `focus-within`, hiding
  // the very buttons the keyboard user was about to press. So focus is moved on purpose:
  // to the confirm button when it opens, back to the delete button when it is dismissed
  // (ROAD_TO_10 8.11).
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

  async function commitRename(): Promise<void> {
    const title = draft.trim();
    setRenaming(false);
    if (!title || title === conversation.title) return;
    onRenamed(id, title);
    try {
      await api.renameConversation(id, title);
    } catch (err) {
      onRenamed(id, conversation.title);
      setError(err instanceof Error ? err.message : "The rename did not save.");
    }
  }

  async function togglePin(): Promise<void> {
    if (pinning) return;
    const next = !conversation.pinned;
    setPinning(true);
    setError(null);
    try {
      await api.setConversationPinned(id, next);
      // Only now does the row move. A pin moves it into another group, which is a
      // different list in the tree, so React remounts the row there — and a failure
      // reported after an optimistic move would be reported to a row that no longer
      // exists. Waiting for the server keeps the row, and its error, where it is.
      onPinned(id, next);
      onPinSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The pin did not save.");
    } finally {
      setPinning(false);
    }
  }

  async function remove(): Promise<void> {
    setConfirmingDelete(false);
    try {
      await api.deleteConversation(id);
      onDeleted(id);
      if (active) router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That chat could not be deleted.");
    }
  }

  if (renaming) {
    return (
      <li className="px-1 py-0.5">
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitRename();
            if (event.key === "Escape") {
              setDraft(conversation.title);
              setRenaming(false);
            }
          }}
          aria-label={`Rename ${conversation.title}`}
          className="h-7 w-full rounded-sm border border-primary bg-surface px-2 text-sm text-accent outline-none"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        href={`/dashboard/c/${id}`}
        className="k-nav-item pr-[4.5rem]"
        aria-current={active ? "page" : undefined}
        // F2 renames, as in a file manager: double-click was the only way in, and a
        // double-click has no keyboard equivalent.
        aria-keyshortcuts="F2"
        onKeyDown={(event) => {
          if (event.key === "F2") {
            event.preventDefault();
            setRenaming(true);
          }
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          setRenaming(true);
        }}
      >
        <span
          className="k-conv-dot"
          data-bound={conversation.has_catia_document ? "true" : "false"}
          aria-hidden="true"
        />
        <span className="truncate">{conversation.title}</span>
        {conversation.branched_from_id && (
          <BranchIcon className="size-3 shrink-0 text-faint" />
        )}
        {conversation.branched_from_id && <span className="sr-only">(a branch)</span>}
        {conversation.has_catia_document && (
          <span className="sr-only">(has a CATIA document)</span>
        )}
        {conversation.pinned && <PinIcon className="size-3 shrink-0 text-faint" />}
        {conversation.pinned && <span className="sr-only">(pinned)</span>}
      </Link>
      {conversation.match === "message" && (
        <span className="block px-2 pb-1 text-[0.6875rem] text-faint">found in a message</span>
      )}

      {/* Shown on hover, on keyboard focus anywhere in the row, and always on the open
          conversation — a touch screen has no hover, so without that last rule pinning
          and deleting were unreachable there. */}
      <span
        className={`absolute right-1 top-1/2 -translate-y-1/2 items-center gap-0.5 group-hover:flex group-focus-within:flex ${
          active || confirmingDelete ? "flex" : "hidden"
        }`}
      >
        {confirmingDelete ? (
          <>
            <button
              ref={confirmRef}
              type="button"
              onClick={() => void remove()}
              className="rounded-sm p-1 text-danger hover:bg-danger/10"
              aria-label={`Confirm deleting ${conversation.title}`}
              title="Delete for good"
            >
              <CheckIcon className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-sm p-1 text-muted hover:text-accent"
              aria-label="Keep this chat"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void togglePin()}
              disabled={pinning}
              className="rounded-sm p-1 text-faint hover:text-accent disabled:opacity-50"
              aria-label={`${conversation.pinned ? "Unpin" : "Pin"} ${conversation.title}`}
              aria-pressed={Boolean(conversation.pinned)}
              title={conversation.pinned ? "Unpin" : "Pin to the top"}
            >
              <PinIcon className="size-3.5" />
            </button>
            <button
              ref={deleteRef}
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-sm p-1 text-faint hover:text-danger"
              aria-label={`Delete ${conversation.title}`}
              title="Delete chat"
            >
              <TrashIcon className="size-3.5" />
            </button>
          </>
        )}
      </span>

      {error && (
        <p role="alert" className="px-2 pb-1 text-[0.6875rem] text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
