"use client";

import { useRef, useState } from "react";

import { AttachIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/pill";
import { isPartFilename, uploadDocumentFile, uploadGeometryFile } from "@/lib/chunked-upload";

export interface AttachPillProps {
  /** Geometry belongs to a project; without one there is nowhere to put it. */
  projectId: string | null;
  /** Documents belong to the conversation, which is what the agent reads. */
  conversationId?: string | null;
  /** Called with a line the user can send, naming what was uploaded. */
  onAttached: (note: string) => void;
  /** Called after a document attachment is created, so the panel can refresh. */
  onAttachmentCreated?: () => void;
}

/**
 * Attach a file to the conversation: a part, or a document.
 *
 * **A part and a document take different paths, and until P4.6 only one of them
 * existed.** A STEP, IGES or STL file becomes a geometry version of the project
 * — it is the thing that gets meshed and analysed. Everything else — a
 * spreadsheet, a PDF, a photograph of a failed weld — becomes an *attachment* of
 * the conversation, which is what the readers in `app/documents/` are for and
 * what the agent is handed at the top of its turn (P4.7).
 *
 * `api.createAttachment` had existed since P4.1 with no caller, so before this
 * the second path did not exist in the product at all: a spreadsheet dropped
 * into the composer was rejected by the file dialog's own filter, and the
 * attachment panel only ever showed rows made through the API by hand.
 *
 * What is disabled depends on what is missing, and the title says which. A part
 * needs a project; a document needs a conversation. A chat with neither can
 * still be typed into — the agent makes the project on the first instruction,
 * and the conversation exists from the first message.
 *
 * On success it writes a line into the composer instead of sending one: the
 * user decides what to ask about the file they just attached.
 */
export function AttachPill({
  projectId,
  conversationId,
  onAttached,
  onAttachmentCreated,
}: AttachPillProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = progress !== null;
  const canAttach = Boolean(projectId) || Boolean(conversationId);

  async function upload(file: File): Promise<void> {
    const part = isPartFilename(file.name);
    if (part && !projectId) {
      setError("This chat has no project yet — ask the agent to start one, then attach the part.");
      return;
    }
    if (!part && !conversationId) {
      setError("Send a message first, then attach the file to this conversation.");
      return;
    }
    setError(null);
    setProgress(0);
    try {
      if (part && projectId) {
        const version = await uploadGeometryFile(projectId, file, { onProgress: setProgress });
        onAttached(`Attached ${version.filename} — geometry v${version.version_number}. `);
      } else if (conversationId) {
        const attachment = await uploadDocumentFile(conversationId, file, {
          onProgress: setProgress,
        });
        // The status is named rather than assumed. An unsupported format gets a
        // row and a reason, and telling the user "attached" about a file
        // nothing could read is the half-truth the status vocabulary exists to
        // prevent.
        onAttached(
          attachment.status === "ready"
            ? `Attached ${attachment.filename}. `
            : `Attached ${attachment.filename} — ${attachment.status}. `,
        );
        onAttachmentCreated?.();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The upload did not finish. Check the file and try again.",
      );
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        // No `accept` filter. It used to list the CAD extensions, which is what
        // made every document unattachable from the GUI; the backend sniffs the
        // content and records what it found, so a filter here would be a second,
        // narrower opinion about what the product reads.
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Pill
        role="status"
        onClick={() => inputRef.current?.click()}
        disabled={!canAttach || busy}
        title={
          canAttach
            ? "Attach a part (STEP, IGES, STL) or a document, spreadsheet or photo"
            : "Send a message first — then you can attach a file to this conversation."
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
