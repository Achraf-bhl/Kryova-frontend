/**
 * The keyboard shortcuts, as data (ROAD_TO_10 8.7).
 *
 * One table drives both the matching and the sheet that lists them, so the sheet cannot
 * promise a key nothing handles. Matching is a pure function of the event's fields, so it
 * is tested without a DOM.
 *
 * `mod` is ⌘ on macOS and Ctrl elsewhere — a user on either has one muscle memory.
 * **A browser keeps ⌘N / Ctrl+N for itself** (a new window) and a page cannot take it, so
 * the new-conversation shortcut is bound twice: ⌘N, which the desktop shell receives, and
 * Alt+N, which a browser tab does too. The sheet shows both, because showing only the one
 * that fails in a tab would be a shortcut that silently does nothing.
 */

import type { MessageKey } from "@/lib/i18n/catalogue";

export type ShortcutId = "stop" | "send" | "new" | "help" | "search";

export interface Shortcut {
  id: ShortcutId;
  /** Key labels as shown on the sheet, one array per accepted chord. */
  chords: string[][];
  /** The catalogue key for what it does, so the sheet can speak the user's language. */
  label: MessageKey;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "stop", chords: [["Esc"]], label: "shortcuts.stop" },
  { id: "send", chords: [["Mod", "Enter"]], label: "shortcuts.send" },
  { id: "new", chords: [["Mod", "N"], ["Alt", "N"]], label: "shortcuts.new" },
  { id: "search", chords: [["Mod", "K"]], label: "shortcuts.search" },
  { id: "help", chords: [["Mod", "/"]], label: "shortcuts.help" },
];

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** An IME composition in progress — a key there commits a candidate, not a command. */
  isComposing?: boolean;
}

/** Which shortcut an event is, or null. Never claims a chord with an extra modifier held. */
export function matchShortcut(event: KeyLike): ShortcutId | null {
  if (event.isComposing) return null;
  const key = event.key.toLowerCase();
  const mod = event.metaKey || event.ctrlKey;
  if (key === "escape" && !mod && !event.altKey && !event.shiftKey) return "stop";
  if (key === "enter" && mod && !event.altKey && !event.shiftKey) return "send";
  if (key === "n" && !event.shiftKey) {
    if (mod && !event.altKey) return "new";
    if (event.altKey && !mod) return "new";
  }
  if (key === "k" && mod && !event.altKey && !event.shiftKey) return "search";
  if (key === "/" && mod && !event.altKey && !event.shiftKey) return "help";
  return null;
}

/** Whether a key chord is being typed into something that wants plain keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** `Mod` rendered for this platform: ⌘ on a Mac, Ctrl elsewhere. */
export function renderKey(label: string, isMac: boolean): string {
  if (label === "Mod") return isMac ? "⌘" : "Ctrl";
  if (label === "Alt") return isMac ? "⌥" : "Alt";
  return label;
}
