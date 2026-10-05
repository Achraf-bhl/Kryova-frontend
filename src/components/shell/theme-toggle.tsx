"use client";

import { useState } from "react";

import { useT } from "@/lib/i18n/locale-context";
import {
  PREFERENCE_KEY,
  applyPreference,
  nextPreference,
  readPreference,
  type ThemePreference,
} from "@/lib/theme";

const GLYPH: Record<ThemePreference, string> = { system: "◐", light: "☀", dark: "☾" };

/** One button cycling system → light → dark (ROAD_TO_10 8.5). The label names the state. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const t = useT();
  // Read after mount: the server cannot know the stored preference, and rendering one
  // value on the server and another on the client is a hydration mismatch.
  const [preference, setPreference] = useState<ThemePreference>(() =>
    typeof window === "undefined" ? "system" : readPreference(),
  );
  return (
    <button
      type="button"
      className={`k-pill ${className}`}
      aria-label={t("theme.change", { state: t(PREFERENCE_KEY[preference]) })}
      title={t(PREFERENCE_KEY[preference])}
      onClick={() => {
        const next = nextPreference(preference);
        applyPreference(next);
        setPreference(next);
      }}
    >
      <span aria-hidden>{GLYPH[preference]}</span>
    </button>
  );
}
