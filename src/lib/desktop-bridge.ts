/**
 * The page's side of the desktop shell (ROAD_TO_10 4.7).
 *
 * `desktop-powers.ts` holds the decisions -- which links may open, which files may attach,
 * which run is worth a notification -- and has no native import. This is the other half: the
 * thin calls into Tauri, kept as small as they can be so the decisions stay testable and the
 * calls stay boring.
 *
 * **There is no `@tauri-apps/*` package here and there will not be one.** The frontend has
 * three runtime dependencies by doctrine and CI fails when the count changes. The shell sets
 * `app.withGlobalTauri`, which puts the same API on `window.__TAURI__`, so everything below
 * reads that object. Each function takes it as an argument (defaulting to the real one),
 * which is also what lets a test pass a recording fake instead of needing a shell.
 *
 * **Every call tolerates the shell being absent**: in a browser `window.__TAURI__` is not
 * there and each function resolves to "nothing happened". The same page runs in both.
 *
 * **IPC reachability from this page is unverified on a machine with a webview** (THE QUEUE
 * G5). The shell's capability grants it by origin (`remote.urls` in
 * `src-tauri/capabilities/default.json`), the part of Tauri 2 most likely to behave
 * differently from its documentation for a window that loads a loopback server.
 */

import { parseDeepLink, routeFor, type RunNotice } from "./desktop-powers";

/** The parts of `window.__TAURI__` this file touches, each optional because a plugin may be absent. */
export interface TauriGlobal {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  event?: {
    listen?: (event: string, handler: (event: unknown) => void) => Promise<() => void>;
  };
  notification?: {
    isPermissionGranted?: () => Promise<boolean>;
    requestPermission?: () => Promise<string>;
    sendNotification?: (options: { title: string; body: string }) => void;
  };
  updater?: {
    /** Resolves to the newer release, or null when this is the newest. Rejects when it cannot ask. */
    check?: () => Promise<{ version?: unknown; downloadAndInstall?: () => Promise<void> } | null>;
  };
}

/** What the shell emits when links are waiting. It carries nothing; `take_deep_links` does. */
export const DEEP_LINK_EVENT = "kryova:deep-link";

/** The shell's object, or null in a browser. */
export function tauriGlobal(scope: object = globalThis): TauriGlobal | null {
  const found = (scope as { __TAURI__?: unknown }).__TAURI__;
  return found !== null && typeof found === "object" ? (found as TauriGlobal) : null;
}

async function invoke(
  tauri: TauriGlobal | null,
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const call = tauri?.core?.invoke;
  if (!call) return undefined;
  try {
    return await call(command, args);
  } catch {
    // The shell refused or the command is missing. Nothing here is worth failing a page for.
    return undefined;
  }
}

/** Links the shell is holding for this page, oldest first. Empty in a browser. */
export async function collectDeepLinks(tauri: TauriGlobal | null = tauriGlobal()): Promise<string[]> {
  const result = await invoke(tauri, "take_deep_links");
  return Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : [];
}

/** Call `onNudge` whenever the shell says links are waiting. Returns how to stop listening. */
export async function subscribeToDeepLinks(
  onNudge: () => void,
  tauri: TauriGlobal | null = tauriGlobal(),
): Promise<() => void> {
  const listen = tauri?.event?.listen;
  if (!listen) return () => {};
  try {
    return await listen(DEEP_LINK_EVENT, () => onNudge());
  } catch {
    return () => {};
  }
}

/** What the page decided about a batch of links: where to go, and what it refused and why. */
export interface LinkOutcome {
  /** The route of the most recently clicked valid link, or null if none was valid. */
  readonly route: string | null;
  readonly refusals: readonly string[];
}

/**
 * Judge links with the page's own allow-list. The shell checked only their shape, so this is
 * the one place that decides what a link may do -- and it can only ever navigate.
 */
export function resolveLinks(raw: readonly string[]): LinkOutcome {
  let route: string | null = null;
  const refusals: string[] = [];
  for (const link of raw) {
    const parsed = parseDeepLink(link);
    if (parsed.ok) route = routeFor(parsed);
    else refusals.push(parsed.reason);
  }
  return { route, refusals };
}

/**
 * The words in the tray's tooltip. The shell cleans and shortens whatever it is given
 * (`status.rs`); this is only the sentence.
 */
export function trayText(state: "connecting" | "connected" | "offline" | "unavailable"): string {
  switch (state) {
    case "connected":
      return "Kryova — CATIA connected";
    case "offline":
      return "Kryova — CATIA not connected";
    case "unavailable":
      return "Kryova — CATIA unavailable";
    case "connecting":
      return "Kryova";
  }
}

/** Tell the shell what to show on the tray icon. */
export async function reportTrayStatus(
  text: string,
  tauri: TauriGlobal | null = tauriGlobal(),
): Promise<void> {
  await invoke(tauri, "set_tray_status", { text });
}

/**
 * Show an operating-system notification, asking permission the first time.
 *
 * Whether to show one at all is `desktop-powers.ts::noticeFor`'s decision -- short runs get
 * none -- and a `null` notice never reaches here. A refusal of permission is respected and
 * not asked again by this call: the plugin remembers it.
 */
export async function sendNotice(
  notice: RunNotice,
  tauri: TauriGlobal | null = tauriGlobal(),
): Promise<boolean> {
  const api = tauri?.notification;
  if (!api?.sendNotification) return false;
  try {
    let granted = (await api.isPermissionGranted?.()) ?? false;
    if (!granted) granted = (await api.requestPermission?.()) === "granted";
    if (!granted) return false;
    api.sendNotification({ title: notice.title, body: notice.body });
    return true;
  } catch {
    return false;
  }
}

/** A newer release the person has not yet been asked about. */
export interface PendingUpdate {
  readonly version: string;
  /** Download, verify against the build's public key, and install. `null` is success; a string is why not. */
  install(): Promise<string | null>;
}

/** Version text is shown to a person, so it is held to what a version looks like. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Ask the update endpoint whether a newer signed release exists (ROAD_TO_10 4.6).
 *
 * `null` for every way of not knowing -- no shell, no updater in this build (a build with no
 * public key registers none), no network, an endpoint that is down -- because none of them is
 * worth a message: an app that cannot check is the app it was a minute ago. It does not
 * install anything. The signature is checked by the shell before any byte is installed and
 * `requireSignedVersion` makes it refuse a response that pairs a new number with an older
 * release; this only reports what the shell has already accepted.
 */
export async function checkForUpdate(
  tauri: TauriGlobal | null = tauriGlobal(),
): Promise<PendingUpdate | null> {
  const check = tauri?.updater?.check;
  if (!check) return null;
  try {
    const update = await check();
    if (!update || typeof update.version !== "string" || !VERSION.test(update.version)) return null;
    const download = update.downloadAndInstall;
    if (typeof download !== "function") return null;
    return {
      version: update.version,
      async install() {
        try {
          // On Windows the installer ends this process, so a success may never be returned.
          await download.call(update);
          return null;
        } catch (error) {
          const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
          return `The update could not be installed${detail}. This version keeps working.`;
        }
      },
    };
  } catch {
    return null;
  }
}
