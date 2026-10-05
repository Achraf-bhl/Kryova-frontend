import { describe, expect, it } from "vitest";

import { SHORTCUTS, matchShortcut, renderKey, type KeyLike } from "./shortcuts";

function key(k: string, extra: Partial<KeyLike> = {}): KeyLike {
  return { key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra };
}

describe("matchShortcut", () => {
  it("reads Escape as stop, with no modifier", () => {
    expect(matchShortcut(key("Escape"))).toBe("stop");
    expect(matchShortcut(key("Escape", { shiftKey: true }))).toBeNull();
  });

  it("sends on either Cmd+Enter or Ctrl+Enter, and not on a bare Enter", () => {
    expect(matchShortcut(key("Enter", { metaKey: true }))).toBe("send");
    expect(matchShortcut(key("Enter", { ctrlKey: true }))).toBe("send");
    expect(matchShortcut(key("Enter"))).toBeNull();
  });

  it("opens a new conversation on Mod+N and on Alt+N, which a browser tab leaves alone", () => {
    expect(matchShortcut(key("n", { metaKey: true }))).toBe("new");
    expect(matchShortcut(key("N", { ctrlKey: true }))).toBe("new");
    expect(matchShortcut(key("n", { altKey: true }))).toBe("new");
    expect(matchShortcut(key("n"))).toBeNull();
    expect(matchShortcut(key("n", { metaKey: true, altKey: true }))).toBeNull();
  });

  it("does not claim a chord with an extra Shift held", () => {
    expect(matchShortcut(key("n", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(key("/", { metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("keeps Mod+K for search and Mod+/ for the sheet", () => {
    expect(matchShortcut(key("k", { ctrlKey: true }))).toBe("search");
    expect(matchShortcut(key("/", { ctrlKey: true }))).toBe("help");
  });

  it("ignores keys during an IME composition", () => {
    expect(matchShortcut(key("Enter", { metaKey: true, isComposing: true }))).toBeNull();
    expect(matchShortcut(key("Escape", { isComposing: true }))).toBeNull();
  });
});

describe("the shortcut table", () => {
  it("lists a chord the matcher actually answers, for every entry", () => {
    for (const shortcut of SHORTCUTS) {
      for (const chord of shortcut.chords) {
        const event = key(chord[chord.length - 1] === "Esc" ? "Escape" : chord[chord.length - 1], {
          metaKey: chord.includes("Mod"),
          altKey: chord.includes("Alt"),
        });
        expect(matchShortcut(event), `${shortcut.id} ${chord.join("+")}`).toBe(shortcut.id);
      }
    }
  });

  it("renders Mod for the platform", () => {
    expect(renderKey("Mod", true)).toBe("⌘");
    expect(renderKey("Mod", false)).toBe("Ctrl");
    expect(renderKey("Enter", true)).toBe("Enter");
  });
});
