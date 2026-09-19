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
 * The slice of the API a *document* upload needs.
 *
 * A second interface rather than four more methods on `ChunkedUploadTransport`:
 * a document never calls `attachGeometry` and a part never calls
 * `createAttachment`, so widening the shared one would make every existing stub
 * implement two methods it has no use for, and would let a caller reach the
 * wrong ending.
 */
export interface DocumentUploadTransport {
  beginUpload(
    filename: string,
    totalSize: number,
    chunkSize?: number,
  ): Promise<{ id: string; chunk_size: number; total_chunks: number }>;
  uploadChunk(uploadId: string, index: number, data: Blob): Promise<void>;
  completeUpload(uploadId: string): Promise<{ id: string; filename: string; size_bytes: number }>;
  createAttachment(body: {
    media_id: string;
    conversation_id?: string | null;
    project_id?: string | null;
    filename?: string;
  }): Promise<AttachmentRead>;
}

export interface DocumentUploadOptions {
  onProgress?: (percent: number) => void;
  conversationId?: string | null;
  projectId?: string | null;
  transport?: DocumentUploadTransport;
}

/**
 * Upload one document and attach it to a conversation.
 *
 * **Always chunked, whatever the size.** The single-shot route is
 * `uploadGeometry`, and that makes a *geometry version* of the project — the one
 * thing a document must not silently become. The chunk loop is the only path
 * that yields a bare media id for `createAttachment` to name.
 *
 * The backend answers 201 whatever the reading produced, so an unsupported
 * format comes back as an `AttachmentRead` whose `status` says so rather than
 * as a thrown error. Callers report that outcome; they must not treat a
 * resolved promise as "it was read".
 */
export async function uploadDocumentFile(
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
    conversation_id: options.conversationId ?? null,
    project_id: options.projectId ?? null,
    // The name the user recognises. The stored blob is named by its digest, and
    // the backend sniffs content *with* this name — a CSV reaches its reader
    // only because the filename travels with the bytes.
    filename: file.name,
  });
}
