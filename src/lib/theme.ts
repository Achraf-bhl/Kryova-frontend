/**
 * Light, dark, or whatever the system says (ROAD_TO_10 8.5).
 *
 * The preference is stored as one of three words and applied as a `data-theme` attribute on
 * `<html>` **only when it is explicit**. For "system" the attribute is absent and
 * `globals.css`'s `prefers-color-scheme` query decides, so a user who never touches the
 * toggle follows their OS live with no script at all. `THEME_INIT_SCRIPT` runs in `<head>`
 * before first paint so an explicit choice does not flash the other theme.
 *
 * No GL here: the viewer reads `viewerBackground` and draws itself.
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "kryova-theme";
export const THEME_CHANGE_EVENT = "kryova-theme-change";

export function parsePreference(raw: string | null | undefined): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

/** The toggle's cycle: follow the system, then force light, then force dark. */
export function nextPreference(preference: ThemePreference): ThemePreference {
  return preference === "system" ? "light" : preference === "light" ? "dark" : "system";
}

export const PREFERENCE_LABEL: Record<ThemePreference, string> = {
  system: "Theme: follows your system",
  light: "Theme: light",
  dark: "Theme: dark",
};

/** RGB 0..1 for `gl.clearColor` — the same paper and ink as the page tokens. */
export function viewerBackground(theme: ResolvedTheme): [number, number, number] {
  return theme === "dark" ? [0.043, 0.067, 0.114] : [0.96, 0.97, 0.98];
}

/**
 * Runs before paint. Wrapped in try/catch because storage can throw (private windows,
 * blocked site data) and a broken theme script must never be why a page is blank.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Apply and remember a preference. Storage failing loses the memory, not the change. */
export function applyPreference(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  if (preference === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", preference);
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not remembered; applied for this page.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

/** What is actually on screen right now. */
export function currentTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "light";
  const explicit = document.documentElement.getAttribute("data-theme");
  return resolveTheme(parsePreference(explicit), systemPrefersDark());
}

/** For `useSyncExternalStore`: fires on a toggle and on the OS changing its scheme. */
export function subscribeTheme(onChange: () => void): () => void {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  query?.addEventListener?.("change", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    query?.removeEventListener?.("change", onChange);
  };
}
