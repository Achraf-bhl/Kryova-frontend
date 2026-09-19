import { describe, expect, it, vi } from "vitest";

import { isGeometryFilename } from "@/components/chat/attach-pill";
import {
  CHUNKED_THRESHOLD_BYTES,
  type DocumentUploadTransport,
  uploadDocumentFile,
} from "@/lib/chunked-upload";
import type { AttachmentRead } from "@/types/api";

/**
 * Attaching a document from the composer — master plan P4.6.
 *
 * **This path did not exist until 2026-09-20, and the plan said it did.** The
 * status of 2026-09-15 recorded that `AttachPill` routed on the filename, that
 * `uploadDocumentFile` existed, and that the `accept` filter "was the whole bug
 * and is gone". `git log --all -S uploadDocumentFile` returns nothing, the
 * filter was still in the file, and `createAttachment` had no caller anywhere —
 * which is exactly what CLAUDE.md's own notes on `app/documents/` said all
 * along. The two documents contradicted each other for five days.
 *
 * So these tests pin the two things that make the path real rather than
 * plausible: a document never becomes a geometry version, and an unreadable
 * file is reported as unreadable.
 */

function attachment(overrides: Partial<AttachmentRead> = {}): AttachmentRead {
  return {
    id: "att-1",
    conversation_id: "conv-1",
    project_id: "proj-1",
    media_id: "media-1",
    filename: "loads.xlsx",
    detected_kind: "spreadsheet",
    detected_format: "xlsx",
    status: "ready",
    status_detail: null,
    reader: "openpyxl",
    reliability: "high",
    ...overrides,
  } as AttachmentRead;
}

function transport(overrides: Partial<DocumentUploadTransport> = {}) {
  const calls: string[] = [];
  const base: DocumentUploadTransport = {
    beginUpload: async (filename, totalSize) => {
      calls.push(`begin:${filename}:${totalSize}`);
      return { id: "up-1", chunk_size: 4, total_chunks: Math.ceil(totalSize / 4) };
    },
    uploadChunk: async (_id, index) => {
      calls.push(`chunk:${index}`);
    },
    completeUpload: async () => {
      calls.push("complete");
      return { id: "media-1", filename: "loads.xlsx", size_bytes: 10 };
    },
    createAttachment: async (body) => {
      calls.push(`attach:${body.filename}:${body.conversation_id}`);
      return attachment();
    },
    ...overrides,
  };
  return { transport: base, calls };
}

function file(name: string, size: number): File {
  return new File([new Uint8Array(size)], name);
}

describe("uploading a document", () => {
  it("always goes through the chunked path, however small the file", async () => {
    // The single-shot route is `uploadGeometry`, which makes a geometry version
    // of the project — the one thing a document must not silently become. So a
    // 10-byte CSV is chunked too.
    const { transport: t, calls } = transport();
    await uploadDocumentFile(file("loads.csv", 10), { transport: t, conversationId: "conv-1" });

    expect(calls[0]).toMatch(/^begin:loads\.csv:10$/);
    expect(calls).toContain("complete");
    expect(calls.some((call) => call.startsWith("chunk:"))).toBe(true);
    expect(10).toBeLessThan(CHUNKED_THRESHOLD_BYTES);
  });

  it("names the conversation and the original filename", async () => {
    // The stored blob is named by its digest, and the backend sniffs content
    // *with* the name it arrived under — a CSV reaches its reader only because
    // the filename travels with the bytes.
    const { transport: t, calls } = transport();
    await uploadDocumentFile(file("loads.csv", 4), { transport: t, conversationId: "conv-7" });

    expect(calls.at(-1)).toBe("attach:loads.csv:conv-7");
  });

  it("reports an unreadable file rather than resolving quietly", async () => {
    // The backend answers 201 whatever the reading produced, so a resolved
    // promise is not "it was read".
    const { transport: t } = transport({
      createAttachment: async () =>
        attachment({ status: "unsupported", status_detail: "no reader for .dwg" }),
    });
    const result = await uploadDocumentFile(file("part.dwg", 4), { transport: t });

    expect(result.status).toBe("unsupported");
    expect(result.status_detail).toBe("no reader for .dwg");
  });

  it("uploads every chunk exactly once, including a short final one", async () => {
    const { transport: t, calls } = transport();
    await uploadDocumentFile(file("notes.txt", 10), { transport: t });

    // 10 bytes at 4 per chunk is 3 chunks, the last of length 2.
    expect(calls.filter((call) => call.startsWith("chunk:"))).toEqual([
      "chunk:0",
      "chunk:1",
      "chunk:2",
    ]);
  });

  it("reports progress as it goes", async () => {
    const onProgress = vi.fn();
    const { transport: t } = transport();
    await uploadDocumentFile(file("notes.txt", 10), { transport: t, onProgress });

    expect(onProgress).toHaveBeenLastCalledWith(100);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });
});

describe("which ending a file gets", () => {
  it.each([".step", ".stp", ".iges", ".igs", ".stl"])(
    "sends %s to the geometry path",
    (extension) => {
      expect(isGeometryFilename(`bracket${extension}`)).toBe(true);
      expect(isGeometryFilename(`BRACKET${extension.toUpperCase()}`)).toBe(true);
    },
  );

  it.each([".xlsx", ".csv", ".docx", ".pptx", ".pdf", ".png", ".txt", ".html"])(
    "sends %s to the document path",
    (extension) => {
      expect(isGeometryFilename(`loads${extension}`)).toBe(false);
    },
  );

  it("does not mistake a document that merely mentions a CAD word", () => {
    // `.stl` at the end is the test, not "stl" anywhere in the name.
    expect(isGeometryFilename("stl-export-notes.txt")).toBe(false);
    expect(isGeometryFilename("step-by-step.docx")).toBe(false);
  });
});
