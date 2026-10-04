"use client";

import { useCallback, useState } from "react";

import { isGeometryFilename } from "@/lib/attach-routing";
import { uploadDocumentFile, uploadGeometryFile } from "@/lib/chunked-upload";

export interface UseAttachUploadOptions {
  /** Geometry belongs to a project; without one there is nowhere to put it. */
  projectId: string | null;
  /** The conversation a document attaches to. */
  conversationId?: string | null;
  /** Called with a line the user can send, naming what was uploaded. */
  onAttached: (note: string) => void;
}

/**
 * Uploading a file the user handed the composer — by button or by drop.
 *
 * The routing lives here rather than in the pill because there are two ways in
 * and only one set of rules. A second copy in the drop handler is how the two
 * would drift: one of them would keep sending everything to
 * `uploadGeometryFile`, which is precisely the bug this replaced.
 */
export function useAttachUpload({
  projectId,
  conversationId,
  onAttached,
}: UseAttachUploadOptions) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File): Promise<void> => {
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
      }
    },
    [projectId, conversationId, onAttached],
  );

  /**
   * Upload dropped files **one at a time, in order**.
   *
   * Not `Promise.all`: each upload drives one progress number, and the chunked
   * endpoints are a session per file. Racing four of them would report the last
   * one to answer and leave the other three invisible.
   */
  const uploadAll = useCallback(
    async (files: readonly File[]): Promise<void> => {
      for (const file of files) {
        await upload(file);
      }
    },
    [upload],
  );

  return { upload, uploadAll, progress, error, busy: progress !== null };
}
