import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api-client";
import type { AttachmentExtraction, AttachmentRead } from "@/types/api";

import { AttachmentPanel } from "./attachment-panel";

/**
 * The attachment panel (P4.6), and the two things it must not do: hide a file
 * it could not read, and show an OCR reading without the warning that it was
 * guessed at.
 */

function attachment(overrides: Partial<AttachmentRead> = {}): AttachmentRead {
  return {
    id: "att-1",
    conversation_id: "conv-1",
    project_id: null,
    media_id: "media-1",
    filename: "loads.pdf",
    detected_kind: "pdf",
    detected_format: "pdf",
    status: "ready",
    status_detail: null,
    reader: "pypdf",
    reliability: "transcribed",
    needs_confirmation: false,
    created_at: "2026-09-10T09:00:00Z",
    extracted_at: "2026-09-10T09:00:01Z",
    ...overrides,
  };
}

function extraction(overrides: Partial<AttachmentExtraction> = {}): AttachmentExtraction {
  return {
    attachment_id: "att-1",
    status: "ready",
    status_detail: null,
    reader: "pypdf",
    reliability: "transcribed",
    unverified_note: null,
    notes: [],
    truncated: false,
    fragment_count: 2,
    fragments: [],
    unread: [],
    dimensions: [],
    ...overrides,
  };
}

function listing(...items: AttachmentRead[]) {
  return { items, total: items.length, page: 1, page_size: 50 };
}

beforeEach(() => {
  vi.spyOn(api, "listAttachments").mockResolvedValue(listing(attachment()));
  vi.spyOn(api, "readExtraction").mockResolvedValue(extraction());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AttachmentPanel", () => {
  it("renders nothing when nothing is attached", async () => {
    // A permanent empty box above every composer is furniture, and furniture is
    // what makes people stop reading the area a real panel will appear in.
    vi.spyOn(api, "listAttachments").mockResolvedValue(listing());

    const { container } = render(<AttachmentPanel conversationId="conv-1" />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("lists a file it could not read rather than omitting it", async () => {
    // "Why is my STEP file not in the list" is much harder to find an answer to
    // than "why does it say not a document".
    vi.spyOn(api, "listAttachments").mockResolvedValue(
      listing(
        attachment(),
        attachment({
          id: "att-2",
          filename: "part.step",
          status: "unsupported",
          status_detail: "part.step is solid geometry, not a document. Upload it as geometry.",
        }),
      ),
    );

    render(<AttachmentPanel conversationId="conv-1" />);

    expect(await screen.findByText("part.step")).toBeInTheDocument();
    expect(screen.getByText(/Upload it as geometry/)).toBeInTheDocument();
  });

  it("does not call an unsupported format a failure", async () => {
    // A STEP file in the document slot is geometry. The file is fine; it is in
    // the wrong place, and calling it broken sends somebody looking for a
    // corruption that is not there.
    vi.spyOn(api, "listAttachments").mockResolvedValue(
      listing(attachment({ status: "unsupported", filename: "part.step" })),
    );

    render(<AttachmentPanel conversationId="conv-1" />);

    const chip = await screen.findByText("Not a document");
    expect(chip).toHaveClass("text-warning");
    expect(chip).not.toHaveClass("text-danger");
  });

  it("gives a genuine read failure the danger tone", async () => {
    vi.spyOn(api, "listAttachments").mockResolvedValue(
      listing(attachment({ status: "failed", filename: "broken.pdf" })),
    );

    render(<AttachmentPanel conversationId="conv-1" />);

    expect(await screen.findByText("Could not read")).toHaveClass("text-danger");
  });

  it("marks an inferred read as unverified in the list", async () => {
    vi.spyOn(api, "listAttachments").mockResolvedValue(
      listing(attachment({ needs_confirmation: true })),
    );

    render(<AttachmentPanel conversationId="conv-1" />);

    expect(await screen.findByText(/unverified/)).toBeInTheDocument();
  });

  it("shows the server's warning above the extracted content, not below it", async () => {
    // A caveat under something already believed is a footnote — the same
    // argument the verification summary makes about factors of safety.
    vi.spyOn(api, "readExtraction").mockResolvedValue(
      extraction({
        unverified_note: "Unverified read — confirm every dimension against the drawing.",
        dimensions: [{ kind: "dimension", text: "40 ±0.1", where: 'layer "DIM"' }],
      }),
    );

    render(<AttachmentPanel conversationId="conv-1" />);
    await userEvent.click(await screen.findByText("loads.pdf"));

    const note = await screen.findByRole("note");
    const dimension = await screen.findByText("40 ±0.1");
    expect(note).toHaveTextContent("confirm every dimension");
    expect(note.compareDocumentPosition(dimension)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows dimensions as candidates with no way to apply one", async () => {
    // Dimension and GD&T extraction is staged as later work, and a wrongly read
    // tolerance is worse than an unread one.
    vi.spyOn(api, "readExtraction").mockResolvedValue(
      extraction({
        dimensions: [{ kind: "dimension", text: "40 ±0.1", where: 'layer "DIM"' }],
      }),
    );

    render(<AttachmentPanel conversationId="conv-1" />);
    await userEvent.click(await screen.findByText("loads.pdf"));

    expect(await screen.findByText(/Candidate readings only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use this/i })).not.toBeInTheDocument();
  });

  it("says when the extraction was truncated rather than hiding it", async () => {
    // A silently shortened extraction reads as a short document.
    vi.spyOn(api, "readExtraction").mockResolvedValue(
      extraction({ truncated: true, fragment_count: 900, fragments: [] }),
    );

    render(<AttachmentPanel conversationId="conv-1" />);
    await userEvent.click(await screen.findByText("loads.pdf"));

    expect(await screen.findByText(/only the first/)).toBeInTheDocument();
  });

  it("shows what a reader saw and declined to interpret", async () => {
    // Not errors: the extraction succeeded. This is the parser saying it would
    // rather tell you than guess.
    vi.spyOn(api, "readExtraction").mockResolvedValue(
      extraction({ unread: [{ what: "R12", why: "could not tell a radius from a revision mark" }] }),
    );

    render(<AttachmentPanel conversationId="conv-1" />);
    await userEvent.click(await screen.findByText("loads.pdf"));

    expect(await screen.findByText(/revision mark/)).toBeInTheDocument();
  });
});
