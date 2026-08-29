import { describe, expect, it, vi } from "vitest";

import {
  CHUNKED_THRESHOLD_BYTES,
  UPLOAD_CHUNK_BYTES,
  uploadGeometryFile,
} from "./chunked-upload";
import type { GeometryVersionRead } from "@/types/api";

const VERSION = { id: "gv-1", version_number: 1 } as unknown as GeometryVersionRead;
const CHUNK = 1_000;

/**
 * A file stub whose `slice` records the byte ranges asked for.
 *
 * Blob slicing in jsdom is real but opaque; recording the ranges is what makes
 * an off-by-one chunk boundary visible instead of silently truncating a CAD
 * file into something that still parses.
 */
function fakeFile(size: number, name = "bracket.stp") {
  const slices: Array<[number, number]> = [];
  const file = {
    name,
    size,
    slice(start: number, end: number) {
      slices.push([start, end]);
      return { size: end - start } as unknown as Blob;
    },
  } as unknown as File;
  return { file, slices };
}

/**
 * Mock of the transport slice `uploadGeometryFile` depends on.
 *
 * The mocks declare no parameters: a zero-arg function is assignable to a
 * function type that takes some, and vitest records the *actual* call arguments
 * regardless, so `toHaveBeenCalledWith` still checks everything that matters.
 */
function makeTransport() {
  return {
    beginUpload: vi.fn(async () => ({
      id: "upload-1",
      chunk_size: UPLOAD_CHUNK_BYTES,
      total_chunks: 1,
    })),
    uploadChunk: vi.fn(async () => {}),
    completeUpload: vi.fn(async () => ({
      id: "media-1",
      filename: "bracket.stp",
      size_bytes: 1,
    })),
    attachGeometry: vi.fn(async () => VERSION),
    uploadGeometry: vi.fn(async () => VERSION),
  };
}

/** A transport whose session declares `totalChunks` chunks of CHUNK bytes. */
function chunkedTransport(totalChunks: number) {
  const api = makeTransport();
  api.beginUpload.mockImplementation(async () => ({
    id: "upload-1",
    chunk_size: CHUNK,
    total_chunks: totalChunks,
  }));
  return api;
}

describe("uploadGeometryFile — single shot", () => {
  it("posts a small file in one request", async () => {
    const api = makeTransport();
    const { file } = fakeFile(1024);

    await expect(uploadGeometryFile("proj-1", file, { transport: api })).resolves.toBe(VERSION);
    expect(api.uploadGeometry).toHaveBeenCalledWith("proj-1", file, undefined);
    expect(api.beginUpload).not.toHaveBeenCalled();
  });

  it("stays on the single-shot path exactly at the threshold", async () => {
    const api = makeTransport();
    const { file } = fakeFile(CHUNKED_THRESHOLD_BYTES);
    await uploadGeometryFile("proj-1", file, { transport: api });
    expect(api.uploadGeometry).toHaveBeenCalledTimes(1);
    expect(api.beginUpload).not.toHaveBeenCalled();
  });

  it("switches to chunked one byte over the threshold", async () => {
    const api = makeTransport();
    const { file } = fakeFile(CHUNKED_THRESHOLD_BYTES + 1);
    await uploadGeometryFile("proj-1", file, { transport: api });
    expect(api.beginUpload).toHaveBeenCalledTimes(1);
    expect(api.uploadGeometry).not.toHaveBeenCalled();
  });
});

describe("uploadGeometryFile — chunked", () => {
  it("slices contiguous, non-overlapping ranges and clamps the last one", async () => {
    const size = CHUNKED_THRESHOLD_BYTES + 1;
    const totalChunks = Math.ceil(size / CHUNK);
    const api = chunkedTransport(totalChunks);
    const { file, slices } = fakeFile(size);

    await uploadGeometryFile("proj-1", file, { transport: api });

    expect(slices).toHaveLength(totalChunks);
    expect(slices[0]).toEqual([0, CHUNK]);
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i][0]).toBe(slices[i - 1][1]);
    }
    // Every byte exactly once, nothing past the end.
    expect(slices.at(-1)![1]).toBe(size);
    expect(slices.reduce((sum, [start, end]) => sum + (end - start), 0)).toBe(size);
  });

  it("honours the chunk size the backend chose, not the one requested", async () => {
    const api = chunkedTransport(2);
    const { file, slices } = fakeFile(CHUNKED_THRESHOLD_BYTES + 1);
    await uploadGeometryFile("proj-1", file, { transport: api });
    expect(api.beginUpload).toHaveBeenCalledWith(
      "bracket.stp",
      CHUNKED_THRESHOLD_BYTES + 1,
      UPLOAD_CHUNK_BYTES,
    );
    expect(slices[0]).toEqual([0, CHUNK]);
  });

  it("uploads chunks in order", async () => {
    const api = chunkedTransport(4);
    const { file } = fakeFile(CHUNKED_THRESHOLD_BYTES + 1);
    await uploadGeometryFile("proj-1", file, { transport: api });
    // The mock declares no parameters (see makeTransport), so the recorded
    // arguments have to be read back through the real signature.
    const indices = (api.uploadChunk.mock.calls as unknown as Array<[string, number, Blob]>).map(
      (call) => call[1],
    );
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("reports progress that ends at 100", async () => {
    const api = chunkedTransport(4);
    const { file } = fakeFile(CHUNKED_THRESHOLD_BYTES + 1);
    const onProgress = vi.fn();
    await uploadGeometryFile("proj-1", file, { transport: api, onProgress });
    expect(onProgress.mock.calls.map((call) => call[0])).toEqual([25, 50, 75, 100]);
  });

  it("completes then attaches, in that order", async () => {
    const order: string[] = [];
    const api = chunkedTransport(1);
    api.completeUpload.mockImplementation(async () => {
      order.push("complete");
      return { id: "media-9", filename: "bracket.stp", size_bytes: 1 };
    });
    api.attachGeometry.mockImplementation(async () => {
      order.push("attach");
      return VERSION;
    });
    const { file } = fakeFile(CHUNKED_THRESHOLD_BYTES + 1);

    await uploadGeometryFile("proj-1", file, { transport: api });
    expect(order).toEqual(["complete", "attach"]);
    expect(api.attachGeometry).toHaveBeenCalledWith("proj-1", "media-9", undefined);
  });

  it("stops at the failing chunk instead of finishing a broken upload", async () => {
    const api = chunkedTransport(5);
    // vitest records the call before running the implementation, so on the
    // third chunk `calls.length` is already 3.
    api.uploadChunk.mockImplementation(async () => {
      if (api.uploadChunk.mock.calls.length === 3) throw new Error("Network error");
    });
    const { file } = fakeFile(CHUNKED_THRESHOLD_BYTES + 1);

    await expect(uploadGeometryFile("proj-1", file, { transport: api })).rejects.toThrow(
      "Network error",
    );
    expect(api.uploadChunk).toHaveBeenCalledTimes(3);
    expect(api.completeUpload).not.toHaveBeenCalled();
  });

  it("passes the note through on both paths", async () => {
    const small = makeTransport();
    await uploadGeometryFile("proj-1", fakeFile(10).file, { transport: small, note: "v2 fillet" });
    expect(small.uploadGeometry).toHaveBeenCalledWith("proj-1", expect.anything(), "v2 fillet");

    const large = chunkedTransport(1);
    await uploadGeometryFile("proj-1", fakeFile(CHUNKED_THRESHOLD_BYTES + 1).file, {
      transport: large,
      note: "v2 fillet",
    });
    expect(large.attachGeometry).toHaveBeenCalledWith("proj-1", "media-1", "v2 fillet");
  });
});
