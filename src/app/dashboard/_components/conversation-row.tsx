"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CheckIcon, CloseIcon, TrashIcon } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import type { ConversationSummary } from "@/types/conversation";

export interface ConversationRowProps {
  conversation: ConversationSummary;
  active: boolean;
  onDeleted: (conversationId: string) => void;
  onRenamed: (conversationId: string, title: string) => void;
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
}: ConversationRowProps) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = conversation.conversation_id;

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
        className="k-nav-item pr-14"
        aria-current={active ? "page" : undefined}
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
        {conversation.has_catia_document && (
          <span className="sr-only">(has a CATIA document)</span>
        )}
      </Link>

      <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex group-focus-within:flex">
        {confirmingDelete ? (
          <>
            <button
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
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-sm p-1 text-faint hover:text-danger"
            aria-label={`Delete ${conversation.title}`}
            title="Delete chat"
          >
            <TrashIcon className="size-3.5" />
          </button>
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
