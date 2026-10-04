"use client";

import { useRef } from "react";

import type { useAttachUpload } from "@/hooks/use-attach-upload";
import { AttachIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/pill";

export interface AttachPillProps {
  /** Geometry belongs to a project; without one there is nowhere to put it. */
  projectId: string | null;
  /**
   * The upload state, owned by the parent.
   *
   * Shared rather than created here because the composer's drop zone uploads
   * through the same controller: two instances would give a dropped file its
   * own invisible progress number while this pill still read "Attach".
   */
  controller: ReturnType<typeof useAttachUpload>;
}

/**
 * Attach a file to the conversation — CAD as a geometry version, anything else
 * as a document.
 *
 * When the chat has no project yet the pill is disabled and says why, rather
 * than opening a file dialog that leads to an upload with no destination. The
 * agent creates the project on the first real instruction, and the pill comes
 * alive on the next render.
 *
 * On success it writes a line into the composer instead of sending one: the
 * user decides what to ask about the file they just attached.
 *
 * **There is deliberately no `accept` filter.** One listing only the CAD
 * extensions is what made a spreadsheet unselectable in the file dialog — the
 * backend reads a dozen formats and records what it found, and a narrower
 * opinion in the client made the wider one unreachable. The dialog offers
 * everything; the routing below decides where it goes.
 */
export function AttachPill({ projectId, controller }: AttachPillProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, progress, error, busy } = controller;

  async function choose(file: File): Promise<void> {
    await upload(file);
    // Cleared after the upload, not inside it: the same file chosen twice in a
    // row fires no `change` event unless the value is reset.
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void choose(file);
        }}
      />
      <Pill
        role="status"
        onClick={() => inputRef.current?.click()}
        disabled={!projectId || busy}
        title={
          projectId
            ? "Attach a file — CAD becomes a geometry version, anything else a document"
            : "This chat has no project yet — ask the agent to start one, then attach a file."
        }
      >
        <AttachIcon className="size-3.5" />
        {busy ? <span className="font-mono text-xs">{progress}%</span> : "Attach"}
      </Pill>
      {error && (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
