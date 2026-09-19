"use client";

import { useRef, useState } from "react";

import { AttachIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/pill";
import { uploadDocumentFile, uploadGeometryFile } from "@/lib/chunked-upload";

/**
 * Extensions that become a *geometry version* of the project. Everything else
 * becomes a conversation attachment.
 *
 * Routing on the extension rather than on content is deliberate at this layer:
 * the backend sniffs the bytes and records what it actually found, so the only
 * decision here is which *ending* the upload has — a geometry version or an
 * attachment — and those are different destinations, not different readings.
 */
const GEOMETRY_EXTENSIONS = [".step", ".stp", ".iges", ".igs", ".stl"] as const;

export function isGeometryFilename(filename: string): boolean {
  const lowered = filename.toLowerCase();
  return GEOMETRY_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

export interface AttachPillProps {
  /** Geometry belongs to a project; without one there is nowhere to put it. */
  projectId: string | null;
  /** The conversation a document attaches to. */
  conversationId?: string | null;
  /** Called with a line the user can send, naming what was uploaded. */
  onAttached: (note: string) => void;
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
export function AttachPill({ projectId, conversationId, onAttached }: AttachPillProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = progress !== null;

  async function upload(file: File): Promise<void> {
    if (!projectId) return;
    setError(null);
    setProgress(0);
    try {
      if (isGeometryFilename(file.name)) {
        const version = await uploadGeometryFile(projectId, file, { onProgress: setProgress });
        onAttached(`Attached ${version.filename} — geometry v${version.version_number}. `);
      } else {
        const attachment = await uploadDocumentFile(file, {
          conversationId,
          projectId,
          onProgress: setProgress,
        });
        // The backend answers 201 even when it could not read the file, because
        // losing the fact that the user handed us something is worse than a
        // recorded failure. So the note says which happened — reporting an
        // unsupported file as "Attached" is the lie this branch exists to avoid.
        onAttached(
          attachment.status === "ready"
            ? `Attached ${attachment.filename} — ${attachment.detected_format}. `
            : `Attached ${attachment.filename}, but it could not be read (${attachment.status}${
                attachment.status_detail ? `: ${attachment.status_detail}` : ""
              }). `,
        );
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
