import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { ApiError, api } from "@/lib/api-client";
import type { DesignRead } from "@/types/api";

import { SpecPanel } from "./spec-panel";

/**
 * The design rendered beside the chat (P5 task 3), and the parameter edit
 * (task 6).
 *
 * The claims worth pinning are the ones where a plausible panel would be
 * *wrong* rather than ugly: a derived parameter offered as editable, an edit
 * that reports only what was typed, and a conversation with no design rendering
 * a permanent empty box above the composer.
 */

const ON_THE_MARKET: Partial<DesignRead> = {
  placed_on_market_on: "2027-03-01",
  modification: {
    character: "after-placing-on-market",
    placed_on_market_on: "2027-03-01",
    headline: "This machine was placed on the market on 1 March 2027. This is not a design-time change.",
    detail:
      "If it is a change to a machine already in service … it is a substantial modification (Article 3(16)). Kryova cannot tell which this is.",
    citations: ["Article 10(4)", "Article 3(16)", "Article 18"],
  },
};

function design(overrides: Partial<DesignRead> = {}): DesignRead {
  return {
    id: "design-1",
    conversation_id: "conv-1",
    project_id: null,
    name: "Bracket",
    digest: "ac5e781f1c9bc1f943475875285b07301769011bbce412fa7b97083947e489f7",
    revision_number: 2,
    placed_on_market_on: null,
    modification: {
      character: "design-time",
      placed_on_market_on: null,
      headline: "Design-time change.",
      detail: "This machine has not been recorded as placed on the market.",
      citations: [],
    },
    created_at: "2026-09-10T09:00:00Z",
    updated_at: "2026-09-10T09:05:00Z",
    document: {
      format_version: 1,
      name: "Bracket",
      description: "Mounts the motor to the frame.",
      material: "aluminium-6061-t6",
      parameters: [
        { name: "thick_mm", unit: "mm", value: 8 },
        { name: "fillet_mm", unit: "mm", expression: "thick_mm / 2" },
      ],
      features: [
        { name: "plate.profile", op: "catia_sketch_create", args: { support: "XY" } },
        {
          name: "plate.body",
          op: "catia_pad",
          args: { sketch: "@plate.profile" },
          note: "Extrude the footprint to thickness.",
        },
        { name: "plate.window", op: "catia_sketch_create", when: "lighten" },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(api, "readDesign").mockResolvedValue(design());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SpecPanel", () => {
  it("renders the spec with its name, revision and material", async () => {
    render(<SpecPanel conversationId="conv-1" revision={1} />);

    expect(await screen.findByText("Bracket")).toBeInTheDocument();
    expect(screen.getByText(/revision 2/)).toBeInTheDocument();
    expect(screen.getByText(/aluminium-6061-t6/)).toBeInTheDocument();
  });

  it("renders nothing at all when the conversation has no design", async () => {
    // Most conversations never record one. A permanent "no design" box above
    // every composer is furniture, and furniture is what makes people stop
    // reading the area a real panel will appear in.
    vi.spyOn(api, "readDesign").mockRejectedValue(new ApiError(404, "no design yet"));

    const { container } = render(<SpecPanel conversationId="conv-1" revision={1} />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows a derived parameter as its formula and offers no field to edit", async () => {
    // The backend refuses to set a derived parameter. Disabling the field is
    // the difference between an explanation and a box that takes a number and
    // then errors — and the formula says what to change *instead*.
    render(<SpecPanel conversationId="conv-1" revision={1} />);
    await screen.findByText("Bracket");

    expect(screen.getByText("= thick_mm / 2")).toBeInTheDocument();
    const fields = screen.getAllByRole("spinbutton");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveValue(8);
  });

  it("shows a conditional feature's condition rather than rendering it like the rest", async () => {
    // A feature that only exists above a certain thickness is not in the part
    // the reader is looking at unless the condition holds. Rendering it
    // identically to an unconditional one is lying by omission.
    render(<SpecPanel conversationId="conv-1" revision={1} />);
    await screen.findByText("Bracket");

    expect(screen.getByText(/only when lighten/)).toBeInTheDocument();
  });

  it("shows the rationale note beside the feature it explains", async () => {
    render(<SpecPanel conversationId="conv-1" revision={1} />);

    expect(
      await screen.findByText("Extrude the footprint to thickness."),
    ).toBeInTheDocument();
  });

  it("commits an edit on Enter and names the downstream nobody touched", async () => {
    // The `downstream` list is the column a reviewer misses: those features
    // were not edited, they stand on something that was, and they may come out
    // a different shape. A message reporting only what was typed is the one
    // that approves a wall thickness and silently moves the bore pattern.
    const edited = design({ revision_number: 3 });
    const patch = vi.spyOn(api, "setDesignParameter").mockResolvedValue({
      design: edited,
      changed: true,
      diff: {
        plan_changed: true,
        affected: ["plate.body", "plate.edges"],
        downstream: ["plate.edges"],
      },
    });
    render(<SpecPanel conversationId="conv-1" revision={1} />);
    await screen.findByText("Bracket");

    const field = screen.getByRole("spinbutton");
    await userEvent.clear(field);
    await userEvent.type(field, "12{Enter}");

    await waitFor(() => expect(patch).toHaveBeenCalledWith("conv-1", "thick_mm", 12));
    expect(await screen.findByText(/plate\.edges/)).toBeInTheDocument();
    expect(screen.getByText(/which nobody edited/)).toBeInTheDocument();
  });

  it("says an edit changed nothing rather than reporting it as a change", async () => {
    // "Saved" after an edit that moved nothing lets a reader believe a change
    // landed that did not.
    vi.spyOn(api, "setDesignParameter").mockResolvedValue({
      design: design(),
      changed: true,
      diff: { plan_changed: false, affected: [], downstream: [] },
    });
    render(<SpecPanel conversationId="conv-1" revision={1} />);
    await screen.findByText("Bracket");

    const field = screen.getByRole("spinbutton");
    await userEvent.clear(field);
    await userEvent.type(field, "9{Enter}");

    expect(
      await screen.findByText(/Nothing that affects the built part changed/),
    ).toBeInTheDocument();
  });

  it("surfaces the backend's refusal instead of swallowing it", async () => {
    vi.spyOn(api, "setDesignParameter").mockRejectedValue(
      new ApiError(422, "fillet_mm is derived from 'thick_mm / 2'."),
    );
    render(<SpecPanel conversationId="conv-1" revision={1} />);
    await screen.findByText("Bracket");

    const field = screen.getByRole("spinbutton");
    await userEvent.clear(field);
    await userEvent.type(field, "12{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("thick_mm / 2");
  });

  it("does not send an edit when the value was not changed", async () => {
    // Blur fires on every field a reader tabs through. Sending a PATCH for each
    // one would append a revision per tab press — a history of nothing.
    const patch = vi.spyOn(api, "setDesignParameter");
    render(<SpecPanel conversationId="conv-1" revision={1} />);
    await screen.findByText("Bracket");

    const field = screen.getByRole("spinbutton");
    await userEvent.click(field);
    await userEvent.tab();

    expect(patch).not.toHaveBeenCalled();
  });

  describe("once the machine is placed on the market (E19 task 5)", () => {
    it("shows nothing about it while the design is design-time", async () => {
      render(<SpecPanel conversationId="conv-1" revision={1} />);
      await screen.findByText("Bracket");

      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });

    it("shows the server's notice, with the clauses it rests on", async () => {
      vi.spyOn(api, "readDesign").mockResolvedValue(design(ON_THE_MARKET));
      render(<SpecPanel conversationId="conv-1" revision={1} />);

      const note = await screen.findByRole("note", { name: "Placed on the market" });
      expect(note).toHaveTextContent("not a design-time change");
      expect(note).toHaveTextContent("substantial modification");
      expect(note).toHaveTextContent("Article 18");
    });

    it("says an edit after placing is not design work before saying what it reached", async () => {
      // The same PATCH, the same diff — and a different legal act. The message
      // is where the difference has to be read, because it is what the person
      // who made the change looks at.
      vi.spyOn(api, "readDesign").mockResolvedValue(design(ON_THE_MARKET));
      vi.spyOn(api, "setDesignParameter").mockResolvedValue({
        design: design({ ...ON_THE_MARKET, revision_number: 3 }),
        changed: true,
        diff: { plan_changed: true, affected: ["plate.body"], downstream: [] },
      });
      render(<SpecPanel conversationId="conv-1" revision={1} />);
      await screen.findByText("Bracket");

      const field = screen.getByRole("spinbutton");
      await userEvent.clear(field);
      await userEvent.type(field, "12{Enter}");

      expect(
        await screen.findByText(/^Changed after this machine was placed on the market\. Saved\./),
      ).toBeInTheDocument();
    });

    it("records the day and re-renders from what the server says", async () => {
      const record = vi
        .spyOn(api, "recordPlacedOnMarket")
        .mockResolvedValue(design(ON_THE_MARKET));
      render(<SpecPanel conversationId="conv-1" revision={1} />);
      await screen.findByText("Bracket");

      fireEvent.change(screen.getByLabelText(/Placed on the market\? Record the day/), {
        target: { value: "2027-03-01" },
      });
      await userEvent.click(screen.getByRole("button", { name: "Record" }));

      await waitFor(() => expect(record).toHaveBeenCalledWith("conv-1", "2027-03-01"));
      expect(await screen.findByRole("note")).toHaveTextContent("1 March 2027");
      expect(screen.getByRole("button", { name: "Correct" })).toBeDisabled();
    });

    it("surfaces a refused date instead of pretending it was recorded", async () => {
      vi.spyOn(api, "recordPlacedOnMarket").mockRejectedValue(
        new ApiError(422, "2 March 2099 has not happened yet."),
      );
      render(<SpecPanel conversationId="conv-1" revision={1} />);
      await screen.findByText("Bracket");

      fireEvent.change(screen.getByLabelText(/Placed on the market\? Record the day/), {
        target: { value: "2099-03-02" },
      });
      await userEvent.click(screen.getByRole("button", { name: "Record" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("has not happened yet");
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });
  });

  describe("the technical file (E19 task 3)", () => {
    it("downloads the server's file under the design's name and revision", async () => {
      const blob = new Blob(["{}"], { type: "application/json" });
      const fetchFile = vi.spyOn(api, "technicalFileBlob").mockResolvedValue(blob);
      // jsdom has no object URLs, so they are provided for this test and
      // removed after it, rather than left on the global for the next one.
      const createUrl = vi.fn(() => "blob:technical-file");
      const revokeUrl = vi.fn();
      const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
      URL.createObjectURL = createUrl;
      URL.revokeObjectURL = revokeUrl;
      onTestFinished(() => {
        URL.createObjectURL = original.create;
        URL.revokeObjectURL = original.revoke;
      });
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      render(<SpecPanel conversationId="conv-1" revision={1} />);
      await screen.findByText("Bracket");

      await userEvent.click(
        screen.getByRole("button", { name: "Export contribution to the technical file" }),
      );

      await waitFor(() => expect(fetchFile).toHaveBeenCalledWith("conv-1"));
      expect(createUrl).toHaveBeenCalledWith(blob);
      const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
      expect(anchor.download).toBe("Bracket-r2-technical-file.json");
      expect(revokeUrl).toHaveBeenCalledWith("blob:technical-file");
    });

    it("says so when the export fails rather than doing nothing", async () => {
      vi.spyOn(api, "technicalFileBlob").mockRejectedValue(new ApiError(404, "no design yet"));
      render(<SpecPanel conversationId="conv-1" revision={1} />);
      await screen.findByText("Bracket");

      await userEvent.click(
        screen.getByRole("button", { name: "Export contribution to the technical file" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent("no design yet");
    });
  });
});
