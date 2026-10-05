"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ShortcutSheet } from "@/components/shell/shortcut-sheet";
import { matchShortcut } from "@/lib/shortcuts";

/**
 * The shortcuts that mean the same on every dashboard page: new conversation and the
 * sheet (ROAD_TO_10 8.7). Stop and send belong to the chat, which owns the turn; search
 * belongs to the sidebar, which owns the field (it has handled ⌘K since before this).
 */
export function GlobalShortcuts() {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const id = matchShortcut(event);
      if (id === "new") {
        event.preventDefault();
        router.push("/dashboard");
      } else if (id === "help") {
        event.preventDefault();
        setSheetOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />;
}
