"use client";

import { useEffect, useRef } from "react";

import { SHORTCUTS, renderKey } from "@/lib/shortcuts";

/**
 * The list of shortcuts, opened with ⌘/ (ROAD_TO_10 8.7). A native `<dialog>`, so focus
 * is trapped and Esc closes it without a library. Esc here must not also stop a running
 * turn: the close handler marks the event handled.
 */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="shortcut-sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-5 text-accent shadow-xl backdrop:bg-black/40"
    >
      <h2 id="shortcut-sheet-title" className="text-base font-semibold">
        Keyboard shortcuts
      </h2>
      <dl className="mt-3 space-y-2">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.id} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="text-muted">{shortcut.description}</dt>
            <dd className="flex shrink-0 flex-col items-end gap-1">
              {shortcut.chords.map((chord) => (
                <span key={chord.join("+")} className="flex gap-1">
                  {chord.map((label) => (
                    <kbd
                      key={label}
                      className="rounded border border-border-strong bg-background px-1.5 py-0.5 text-xs"
                    >
                      {renderKey(label, isMac)}
                    </kbd>
                  ))}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 text-right">
        <button type="button" onClick={onClose} className="k-pill">
          Close
        </button>
      </div>
    </dialog>
  );
}
