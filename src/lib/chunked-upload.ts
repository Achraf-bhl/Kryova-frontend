import { api } from "@/lib/api-client";
import type { GeometryVersionRead } from "@/types/api";

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
