"use client";

import { useRef, useState } from "react";

import { AttachIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/pill";
import { uploadGeometryFile } from "@/lib/chunked-upload";

export interface AttachPillProps {
  /** Geometry belongs to a project; without one there is nowhere to put it. */
  projectId: string | null;
  /** Called with a line the user can send, naming what was uploaded. */
  onAttached: (note: string) => void;
}

/**
 * Attach a CAD file to the conversation's project.
 *
 * When the chat has no project yet the pill is disabled and says why, rather
 * than opening a file dialog that leads to an upload with no destination. The
 * agent creates the project on the first real instruction, and the pill comes
 * alive on the next render.
 *
 * On success it writes a line into the composer instead of sending one: the
 * user decides what to ask about the file they just attached.
 */
export function AttachPill({ projectId, onAttached }: AttachPillProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = progress !== null;

  async function upload(file: File): Promise<void> {
    if (!projectId) return;
    setError(null);
    setProgress(0);
    try {
      const version = await uploadGeometryFile(projectId, file, { onProgress: setProgress });
      onAttached(`Attached ${version.filename} — geometry v${version.version_number}. `);
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
        accept=".step,.stp,.iges,.igs,.stl"
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
            ? "Attach a STEP, IGES or STL file to this project"
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
