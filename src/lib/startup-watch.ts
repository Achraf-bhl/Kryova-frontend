/**
 * What the setup page does while the desktop app is still starting (ROAD_TO_10 4.3).
 *
 * The window opens as soon as the frontend answers, which is well before the backend does:
 * on the very first launch the backend has a database to create and migrate, and a hidden
 * window for minutes reads as a double-click that did nothing. The shell opens it on
 * `/setup?starting=1`; the page then asks the API every few seconds and moves on when it
 * answers. The timings and wording live here so they can be tested without a timer.
 */

/** The query the shell opens the window with (`STARTING_PAGE` in `src-tauri/src/layout.rs`). */
export const STARTING_QUERY = "starting=1";

/** How often the page asks whether the API is up. Slow enough not to be a flood, fast enough that the app appears promptly. */
export const POLL_MS = 2_500;

/** From here on the page offers "Copy diagnostics" -- a normal start is long over. */
export const DIAGNOSTICS_AFTER_MS = 90_000;

export function isStartingQuery(search: string): boolean {
  return new URLSearchParams(search).get("starting") === "1";
}

export interface StartingMessage {
  readonly headline: string;
  readonly detail: string;
  readonly showDiagnostics: boolean;
}

/**
 * What to say after `elapsedMs`. It never claims progress it cannot see -- there is no
 * percentage, only the truth about what a first launch does -- and it never says "failed":
 * the shell decides when to give up, and a page that says so first would be guessing.
 */
export function startingMessage(elapsedMs: number): StartingMessage {
  if (elapsedMs < 20_000) {
    return {
      headline: "Starting Kryova…",
      detail: "This window opens the app as soon as it is ready.",
      showDiagnostics: false,
    };
  }
  return {
    headline: "Still starting…",
    detail:
      "The first launch creates Kryova's database, which can take a few minutes, longer while " +
      "antivirus scans a fresh install. Later launches take seconds.",
    showDiagnostics: elapsedMs >= DIAGNOSTICS_AFTER_MS,
  };
}

/** Navigation as a seam, so the page's test can see where it went instead of leaving jsdom. */
export const navigation = {
  replace: (path: string): void => {
    window.location.replace(path);
  },
};
