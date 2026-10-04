/**
 * The decidable half of the desktop's extra powers — P7 task 3.
 *
 * Three powers the desktop build has and the browser does not: opening and saving local
 * files into the attachment pipeline, an OS notification when a long run finishes, and
 * deep links (`kryova://run/…`) from CI or an email into the app. Each has a decision in
 * it that is worth testing and a native call that is not, so the decision lives here — no
 * Tauri import, no `window`, nothing that needs a shell to run.
 *
 * **The deep link is the security half of this task and is treated as one.** The link
 * arrives in an email or a CI comment, the person clicking it cannot read it first, and
 * the app it opens is *already signed in*. That is the threat `safe-redirect.ts` handles
 * for `?next=`, arriving through the operating system instead of the browser — and worse
 * in one way, because there is no URL bar to look at afterwards.
 *
 * So `parseDeepLink` is an **allow-list of shapes**, not a blocklist of bad ones:
 *
 * - exactly one scheme, `kryova:`;
 * - exactly three targets, all of them **read-only** views — `run`, `conversation`,
 *   `project`;
 * - exactly one id segment, matching a conservative pattern;
 * - everything else refused *by name*, so a refusal can be shown rather than swallowed.
 *
 * **Nothing a link reaches performs an action.** A link that could start a run, approve a
 * gate or delete a project would be a one-click remote command against an authenticated
 * session. The three targets navigate and nothing more, and that is a property of this
 * list rather than of the screens it names — which is why adding a target here is a
 * security decision and is commented as one.
 *
 * Rebuilt 2026-09-17. The master plan claimed this module on 2026-09-16 and it had never
 * been committed; the argument above is what that status recorded.
 */

/** A file offered to the attachment pipeline by the OS, before anything reads it. */
export interface LocalFile {
  readonly name: string;
  readonly sizeBytes: number;
}

/** What a deep link resolved to, or why it did not. */
export type DeepLink =
  | { readonly ok: true; readonly target: DeepLinkTarget; readonly id: string }
  | { readonly ok: false; readonly reason: string };

/** The only targets a link may name. All three are read-only views. */
export const DEEP_LINK_TARGETS = ["run", "conversation", "project"] as const;
export type DeepLinkTarget = (typeof DEEP_LINK_TARGETS)[number];

export const DEEP_LINK_SCHEME = "kryova:";

/**
 * What an id may look like: uuids and the slugs this product mints, nothing else.
 *
 * Deliberately narrower than "any path segment". An id is never `..`, never has a slash
 * in it and never carries a query — and a pattern that permits those is how a deep link
 * becomes a way to address something the allow-list did not intend.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Largest file the desktop will hand to the attachment pipeline, in bytes. */
export const MAX_LOCAL_FILE_BYTES = 256 * 1024 * 1024;

/**
 * Extensions the attachment pipeline can read. Anything else is refused *here* rather
 * than uploaded and refused by the server, because a local open is instant and a round
 * trip to be told "no" is not.
 */
export const OPENABLE_EXTENSIONS = [
  ".step",
  ".stp",
  ".iges",
  ".igs",
  ".stl",
  ".csv",
  ".xlsx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
  ".md",
  ".dxf",
] as const;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

/** Whether the pipeline will take this file, and why not when it will not. */
export function canOpen(file: LocalFile): { ok: boolean; reason: string | null } {
  if (file.sizeBytes <= 0) {
    return { ok: false, reason: "That file is empty." };
  }
  if (file.sizeBytes > MAX_LOCAL_FILE_BYTES) {
    const mb = Math.round(MAX_LOCAL_FILE_BYTES / (1024 * 1024));
    return { ok: false, reason: `Files are limited to ${mb} MB.` };
  }
  const extension = extensionOf(file.name);
  if (!(OPENABLE_EXTENSIONS as readonly string[]).includes(extension)) {
    const known = OPENABLE_EXTENSIONS.join(", ");
    return {
      ok: false,
      reason: extension
        ? `Kryova cannot read ${extension} files. It reads: ${known}.`
        : `That file has no extension, so Kryova cannot tell what it is. It reads: ${known}.`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Resolve a deep link, or say exactly why not.
 *
 * Every refusal names what was wrong. A link that silently does nothing is the worst of
 * the three outcomes: the user clicked something, the app came to the front, and nothing
 * happened — which reads as a broken app rather than a rejected link.
 */
export function parseDeepLink(raw: string): DeepLink {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `${raw} is not a link Kryova can read.` };
  }
  if (url.protocol !== DEEP_LINK_SCHEME) {
    return {
      ok: false,
      reason: `Kryova only opens ${DEEP_LINK_SCHEME}// links, not ${url.protocol}//.`,
    };
  }
  // `kryova://run/abc` puts `run` in the host and `/abc` in the path.
  const target = url.hostname;
  const segments = url.pathname.split("/").filter((part) => part.length > 0);
  if (!(DEEP_LINK_TARGETS as readonly string[]).includes(target)) {
    return {
      ok: false,
      reason: `Kryova opens ${DEEP_LINK_TARGETS.join(", ")} links; ${target || "that"} is not one of them.`,
    };
  }
  if (segments.length !== 1) {
    return {
      ok: false,
      reason: `A ${target} link names exactly one ${target}; that one names ${segments.length}.`,
    };
  }
  const id = segments[0];
  if (!ID.test(id)) {
    return { ok: false, reason: `${id} is not an id Kryova recognises.` };
  }
  return { ok: true, target: target as DeepLinkTarget, id };
}

/** The in-app route a resolved link navigates to. Read-only, every one. */
export function routeFor(link: Extract<DeepLink, { ok: true }>): string {
  switch (link.target) {
    case "run":
      return `/dashboard/simulations/${link.id}`;
    case "conversation":
      return `/dashboard/conversations/${link.id}`;
    case "project":
      return `/dashboard/projects/${link.id}`;
  }
}

/** A finished run, as an OS notification would put it. */
export interface RunNotice {
  readonly title: string;
  readonly body: string;
}

/**
 * Whether a finished run is worth interrupting someone for, and what to say.
 *
 * **Short runs get no notification.** A toast for something that finished while the user
 * was still looking at it is noise, and noise is how a user turns notifications off —
 * after which the twenty-minute solve they *did* want to know about is silent too.
 */
export const NOTIFY_AFTER_SECONDS = 60;

export function noticeFor(
  status: "succeeded" | "failed" | "cancelled",
  seconds: number,
  name: string,
): RunNotice | null {
  if (seconds < NOTIFY_AFTER_SECONDS) return null;
  const minutes = Math.round(seconds / 60);
  const took = minutes >= 1 ? `${minutes} min` : `${Math.round(seconds)} s`;
  switch (status) {
    case "succeeded":
      return { title: "Simulation finished", body: `${name} finished in ${took}.` };
    case "failed":
      // Named as a failure rather than softened: a run that did not produce an answer
      // must not read like one that did.
      return { title: "Simulation failed", body: `${name} failed after ${took}.` };
    case "cancelled":
      // A cancellation is the product doing what it was told, and is not a failure —
      // `app/core/interruption.py` keeps the same distinction on the server.
      return { title: "Simulation stopped", body: `${name} was stopped after ${took}.` };
  }
}
