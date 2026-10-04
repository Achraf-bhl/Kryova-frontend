import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Composer } from "@/components/chat/composer";

/**
 * Dropping a file on the composer — master plan P4.6.
 *
 * The status said drag-and-drop "reaches only the geometry path". It reached
 * nothing: `git log --all -S onDrop` over `src/` returns nothing, so there was
 * no drop handler anywhere in the app. This is the first one.
 *
 * Two behaviours are worth pinning because both are silent when wrong: a drag
 * of *text* across the box must not look like an upload, and `onDragLeave`
 * fires as the pointer crosses child elements, so a naive implementation clears
 * the highlight while the file is still over the composer.
 */

function composer(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  return render(
    <Composer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      deepAnalysis={false}
      onDeepAnalysisChange={() => {}}
      {...props}
    />,
  );
}

function fileDrag(files: File[]) {
  return {
    dataTransfer: {
      files,
      types: ["Files"],
      items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    },
  };
}

const TEXT_DRAG = { dataTransfer: { files: [], types: ["text/plain"], items: [] } };

describe("dropping a file on the composer", () => {
  it("hands the files to the caller", () => {
    const onFilesDropped = vi.fn();
    const { container } = composer({ onFilesDropped });
    const zone = container.querySelector(".k-composer")!;

    const file = new File(["x"], "loads.xlsx");
    fireEvent.drop(zone, fileDrag([file]));

    expect(onFilesDropped).toHaveBeenCalledTimes(1);
    expect(onFilesDropped.mock.calls[0][0].map((f: File) => f.name)).toEqual(["loads.xlsx"]);
  });

  it("hands over every file of a multi-file drop, in order", () => {
    const onFilesDropped = vi.fn();
    const { container } = composer({ onFilesDropped });
    const zone = container.querySelector(".k-composer")!;

    fireEvent.drop(
      zone,
      fileDrag([new File(["a"], "a.csv"), new File(["b"], "b.step"), new File(["c"], "c.pdf")]),
    );

    expect(onFilesDropped.mock.calls[0][0].map((f: File) => f.name)).toEqual([
      "a.csv",
      "b.step",
      "c.pdf",
    ]);
  });

  it("highlights while a file is over it, and stops after the drop", () => {
    const { container } = composer({ onFilesDropped: vi.fn() });
    const zone = container.querySelector(".k-composer")!;

    fireEvent.dragEnter(zone, fileDrag([new File(["x"], "a.csv")]));
    expect(zone.className).toContain("ring-2");

    fireEvent.drop(zone, fileDrag([new File(["x"], "a.csv")]));
    expect(zone.className).not.toContain("ring-2");
  });

  it("keeps the highlight while the pointer crosses a child", () => {
    // `dragleave` fires when the pointer moves onto the textarea inside the
    // box. Counting enters against leaves is what stops the highlight
    // flickering off while the file is still over the composer.
    const { container } = composer({ onFilesDropped: vi.fn() });
    const zone = container.querySelector(".k-composer")!;
    const drag = fileDrag([new File(["x"], "a.csv")]);

    fireEvent.dragEnter(zone, drag);
    fireEvent.dragEnter(screen.getByLabelText("Message the Kryova agent"), drag);
    fireEvent.dragLeave(zone, drag);

    expect(zone.className).toContain("ring-2");
  });

  it("ignores a drag of text", () => {
    // Dragging selected text across the composer is an ordinary thing to do
    // and must not look like an upload about to happen.
    const onFilesDropped = vi.fn();
    const { container } = composer({ onFilesDropped });
    const zone = container.querySelector(".k-composer")!;

    fireEvent.dragEnter(zone, TEXT_DRAG);
    expect(zone.className).not.toContain("ring-2");

    fireEvent.drop(zone, TEXT_DRAG);
    expect(onFilesDropped).not.toHaveBeenCalled();
  });

  it("takes no drops at all when the chat has nowhere to put them", () => {
    // `onFilesDropped` is absent when there is no project. A zone that accepted
    // the file and silently dropped it would be worse than one that does not
    // light up.
    const { container } = composer({ onFilesDropped: undefined });
    const zone = container.querySelector(".k-composer")!;

    fireEvent.dragEnter(zone, fileDrag([new File(["x"], "a.csv")]));
    expect(zone.className).not.toContain("ring-2");
  });
});
