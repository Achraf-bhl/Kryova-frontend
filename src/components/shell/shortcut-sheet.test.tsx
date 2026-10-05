import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShortcutSheet } from "@/components/shell/shortcut-sheet";
import { translate } from "@/lib/i18n/catalogue";
import { SHORTCUTS } from "@/lib/shortcuts";

// jsdom has no <dialog>.showModal; the component guards the call, so the content is
// still in the tree and the listing is what is under test.
describe("ShortcutSheet", () => {
  it("lists every shortcut in the table", () => {
    render(<ShortcutSheet open={false} onClose={() => {}} />);
    for (const shortcut of SHORTCUTS) {
      expect(screen.getByText(translate("en", shortcut.label), { selector: "dt" })).toBeInTheDocument();
    }
  });

  it("closes from its button", () => {
    const onClose = vi.fn();
    render(<ShortcutSheet open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
