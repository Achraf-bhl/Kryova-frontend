import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadDocumentFile, uploadGeometryFile } from "@/lib/chunked-upload";
import type { AttachmentRead, GeometryVersionRead } from "@/types/api";

import { AttachPill } from "./attach-pill";

/* The uploaders are mocked and `isPartFilename` is not: which path a filename
   takes is the decision under test, so mocking it would assert the mock. */
vi.mock("@/lib/chunked-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chunked-upload")>();
  return {
    ...actual,
    uploadGeometryFile: vi.fn(),
    uploadDocumentFile: vi.fn(),
  };
});

const geometryUpload = vi.mocked(uploadGeometryFile);
const documentUpload = vi.mocked(uploadDocumentFile);

/**
 * The composer's two upload paths (master plan P4.6).
 *
 * The correction this file pins: a part becomes a geometry version, a document
 * becomes an attachment of the conversation, and before 2026-09-15 only the
 * first existed — `createAttachment` was defined and called by nothing, so a
 * spreadsheet could not be attached from the GUI at all. A test that only
 * checked "the pill uploads something" would have passed throughout.
 *
 * Written on Linux and **not run** (the user's rule; Windows runs them).
 */

function geometryVersion(): GeometryVersionRead {
  return {
    id: "geo-1",
    project_id: "proj-1",
    version_number: 3,
    filename: "bracket.step",
    file_format: "step",
    media_id: "media-1",
    note: null,
    stats: {},
    size_bytes: 1024,
    checksum_sha256: "a".repeat(64),
    created_at: "2026-09-15T09:00:00Z",
  } as GeometryVersionRead;
}

function attachment(overrides: Partial<AttachmentRead> = {}): AttachmentRead {
  return {
    id: "att-1",
    conversation_id: "conv-1",
    project_id: null,
    media_id: "media-2",
    filename: "loads.xlsx",
    detected_kind: "spreadsheet",
    detected_format: "xlsx",
    status: "ready",
    status_detail: null,
    reader: "openpyxl",
    reliability: "transcribed",
    needs_confirmation: false,
    created_at: "2026-09-15T09:00:00Z",
    extracted_at: "2026-09-15T09:00:01Z",
    ...overrides,
  } as AttachmentRead;
}

function file(name: string, type = "application/octet-stream"): File {
  return new File(["x"], name, { type });
}

beforeEach(() => {
  geometryUpload.mockReset();
  documentUpload.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a part goes to the project", () => {
  it("uploads a STEP file as geometry", async () => {
    geometryUpload.mockResolvedValue(geometryVersion());
    const onAttached = vi.fn();
    render(
      <AttachPill projectId="proj-1" conversationId="conv-1" onAttached={onAttached} />,
    );

    await userEvent.upload(fileInput(), file("bracket.step"));

    await waitFor(() => expect(geometryUpload).toHaveBeenCalled());
    expect(documentUpload).not.toHaveBeenCalled();
    expect(onAttached).toHaveBeenCalledWith(expect.stringContaining("geometry v3"));
  });
});

describe("a document goes to the conversation", () => {
  it("uploads a spreadsheet as an attachment", async () => {
    documentUpload.mockResolvedValue(attachment());
    const onAttached = vi.fn();
    render(
      <AttachPill projectId="proj-1" conversationId="conv-1" onAttached={onAttached} />,
    );

    await userEvent.upload(fileInput(), file("loads.xlsx"));

    await waitFor(() => expect(documentUpload).toHaveBeenCalled());
    expect(documentUpload.mock.calls[0][0]).toBe("conv-1");
    expect(geometryUpload).not.toHaveBeenCalled();
  });

  it("refreshes the panel once the row exists", async () => {
    documentUpload.mockResolvedValue(attachment());
    const onAttachmentCreated = vi.fn();
    render(
      <AttachPill
        projectId="proj-1"
        conversationId="conv-1"
        onAttached={vi.fn()}
        onAttachmentCreated={onAttachmentCreated}
      />,
    );

    await userEvent.upload(fileInput(), file("notes.pdf"));

    await waitFor(() => expect(onAttachmentCreated).toHaveBeenCalledTimes(1));
  });

  it("says so when the file could not be read", async () => {
    /* An unsupported format has a row and a reason. Saying "Attached" alone
       would be the half-truth P4.1's status vocabulary exists to prevent. */
    documentUpload.mockResolvedValue(attachment({ status: "unsupported", filename: "part.sldprt" }));
    const onAttached = vi.fn();
    render(
      <AttachPill projectId="proj-1" conversationId="conv-1" onAttached={onAttached} />,
    );

    await userEvent.upload(fileInput(), file("part.sldprt"));

    await waitFor(() =>
      expect(onAttached).toHaveBeenCalledWith(expect.stringContaining("unsupported")),
    );
  });

  it("is attachable with no project, because a document does not need one", async () => {
    documentUpload.mockResolvedValue(attachment());
    render(<AttachPill projectId={null} conversationId="conv-1" onAttached={vi.fn()} />);

    await userEvent.upload(fileInput(), file("loads.csv"));

    await waitFor(() => expect(documentUpload).toHaveBeenCalled());
  });
});

describe("what it refuses, and how it says so", () => {
  it("refuses a part with no project and names what is missing", async () => {
    render(<AttachPill projectId={null} conversationId="conv-1" onAttached={vi.fn()} />);

    await userEvent.upload(fileInput(), file("bracket.step"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/project/i));
    expect(geometryUpload).not.toHaveBeenCalled();
  });

  it("refuses a document with no conversation", async () => {
    render(<AttachPill projectId="proj-1" conversationId={null} onAttached={vi.fn()} />);

    await userEvent.upload(fileInput(), file("loads.xlsx"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/message/i));
    expect(documentUpload).not.toHaveBeenCalled();
  });

  it("surfaces an upload failure instead of reporting success", async () => {
    documentUpload.mockRejectedValue(new Error("Storage is full"));
    const onAttached = vi.fn();
    render(
      <AttachPill projectId="proj-1" conversationId="conv-1" onAttached={onAttached} />,
    );

    await userEvent.upload(fileInput(), file("loads.xlsx"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Storage is full"));
    expect(onAttached).not.toHaveBeenCalled();
  });
});

describe("the file dialog", () => {
  it("does not filter out documents", () => {
    /* The `accept` list was the whole bug: it named only the CAD extensions, so
       the dialog would not offer a spreadsheet in the first place. */
    render(<AttachPill projectId="proj-1" conversationId="conv-1" onAttached={vi.fn()} />);

    expect(fileInput().getAttribute("accept")).toBeNull();
  });
});

/** The hidden input, which carries no label because the Pill is the control. */
function fileInput(): HTMLInputElement {
  const input = globalThis.document.querySelector('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  return input as HTMLInputElement;
}
