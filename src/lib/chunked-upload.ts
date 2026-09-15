import { api } from "@/lib/api-client";
import type { AttachmentRead, GeometryVersionRead } from "@/types/api";

/** Files above this go through the chunked endpoints instead of one multipart POST. */
export const CHUNKED_THRESHOLD_BYTES = 16 * 1024 * 1024;
/** Requested chunk size. The backend may answer with a different one. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * The slice of the API this uploader needs.
 *
 * Narrowed to an interface so the loop can be driven by a stub in tests: the
 * chunk boundary arithmetic is the kind of thing that is wrong by one slice for
 * months without anyone noticing, because a truncated STEP file usually still
 * parses into *something*.
 */
export interface ChunkedUploadTransport {
  beginUpload(
    filename: string,
    totalSize: number,
    chunkSize?: number,
  ): Promise<{ id: string; chunk_size: number; total_chunks: number }>;
  uploadChunk(uploadId: string, index: number, data: Blob): Promise<void>;
  completeUpload(uploadId: string): Promise<{ id: string; filename: string; size_bytes: number }>;
  attachGeometry(projectId: string, mediaId: string, note?: string): Promise<GeometryVersionRead>;
  uploadGeometry(projectId: string, file: File, note?: string): Promise<GeometryVersionRead>;
}

/**
 * What `uploadDocumentFile` needs: the chunk loop, and the attachment row.
 *
 * A separate interface rather than two more methods on the one above, because
 * the two uploads genuinely need different things — a document never touches
 * `attachGeometry` and a part never touches `createAttachment` — and widening
 * the shared one would make every existing test stub implement a method its
 * path cannot reach.
 */
export interface DocumentUploadTransport
  extends Pick<ChunkedUploadTransport, "beginUpload" | "uploadChunk" | "completeUpload"> {
  createAttachment(body: {
    media_id: string;
    conversation_id?: string | null;
    project_id?: string | null;
    filename?: string;
  }): Promise<AttachmentRead>;
}

export interface DocumentUploadOptions {
  /** Called with 0–100 after each chunk lands. */
  onProgress?: (percent: number) => void;
  transport?: DocumentUploadTransport;
}

/**
 * The extensions that are *parts* rather than documents.
 *
 * The composer routes on this: a part becomes a geometry version of the
 * project, everything else becomes an attachment of the conversation. Kept
 * beside the uploader rather than in the component so the two paths cannot
 * disagree about what a part is.
 */
export const PART_EXTENSIONS = [".step", ".stp", ".iges", ".igs", ".stl"] as const;

export function isPartFilename(filename: string): boolean {
  const lowered = filename.toLowerCase();
  return PART_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

export interface UploadOptions {
  /** Called with 0–100 after each chunk lands. Never called on the single-shot path. */
  onProgress?: (percent: number) => void;
  note?: string;
  transport?: ChunkedUploadTransport;
}

/**
 * Upload one CAD file and attach it as a geometry version.
 *
 * Small files go up in a single multipart request. Large ones are sliced: the
 * backend hands back the chunk size it actually wants (which is why the slice
 * uses `session.chunk_size`, not the size we asked for) and the number of
 * chunks it expects.
 */
export async function uploadGeometryFile(
  projectId: string,
  file: File,
  options: UploadOptions = {},
): Promise<GeometryVersionRead> {
  const transport = options.transport ?? api;

  if (file.size <= CHUNKED_THRESHOLD_BYTES) {
    return transport.uploadGeometry(projectId, file, options.note);
  }

  const session = await transport.beginUpload(file.name, file.size, UPLOAD_CHUNK_BYTES);
  for (let index = 0; index < session.total_chunks; index++) {
    const start = index * session.chunk_size;
    // The final chunk is short; clamping to file.size stops the last slice
    // reading past the end (a zero-length Blob the backend then rejects).
    const end = Math.min(start + session.chunk_size, file.size);
    await transport.uploadChunk(session.id, index, file.slice(start, end));
    options.onProgress?.(Math.round(((index + 1) / session.total_chunks) * 100));
  }

  const media = await transport.completeUpload(session.id);
  return transport.attachGeometry(projectId, media.id, options.note);
}

/**
 * Upload one document and attach it to the conversation (master plan P4.6).
 *
 * The other half of `uploadGeometryFile`, and the one that was missing:
 * `api.createAttachment` had existed since P4.1 with no caller, so a
 * spreadsheet, a PDF or a photograph dropped into the composer became a
 * geometry upload or nothing at all. Found 2026-09-15.
 *
 * Always chunked, whatever the size. The single-shot route is
 * `uploadGeometry`, which makes a geometry version — exactly what a document
 * must not become — and the chunk loop is the only path that yields a bare
 * media id. A small file is one chunk, so the cost is two extra round trips on
 * a file that was going to be read by a model anyway.
 *
 * The attachment is created whatever the reading produced: an unsupported
 * format is a recorded outcome with a row, not a failed upload, because
 * refusing loses the fact that the user handed us something.
 */
export async function uploadDocumentFile(
  conversationId: string,
  file: File,
  options: DocumentUploadOptions = {},
): Promise<AttachmentRead> {
  const transport = options.transport ?? api;

  const session = await transport.beginUpload(file.name, file.size, UPLOAD_CHUNK_BYTES);
  for (let index = 0; index < session.total_chunks; index++) {
    const start = index * session.chunk_size;
    const end = Math.min(start + session.chunk_size, file.size);
    await transport.uploadChunk(session.id, index, file.slice(start, end));
    options.onProgress?.(Math.round(((index + 1) / session.total_chunks) * 100));
  }

  const media = await transport.completeUpload(session.id);
  return transport.createAttachment({
    media_id: media.id,
    conversation_id: conversationId,
    // The name the user's own filesystem gave it, not the stored blob's: the
    // backend sniffs content first and falls back to this extension, and the
    // stored blob is named by digest and has no extension at all.
    filename: file.name,
  });
}
