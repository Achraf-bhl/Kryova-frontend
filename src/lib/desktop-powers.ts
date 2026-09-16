/**
 * The three things the desktop build can do that a browser tab cannot (P7.3).
 *
 * Local file open/save into the attachment pipeline, an OS notification when a long run
 * finishes, and `kryova://` deep links from CI or email. The task's own words are **"used
 * sparingly"**, and that is a real constraint rather than a flourish: every power here is
 * one the web build does not have, so anything built on one splits the product in two.
 * Each is therefore an *addition* to a flow that already works without it.
 *
 * This module is the part that is decidable without a native API: which file is
 * acceptable, whether a run is worth interrupting someone for, and — the one that matters
 * — what a `kryova://` URL is allowed to mean.
 *
 * **A deep link is untrusted input, and this is the security half of the task.** The link
 * arrives from an email or a CI comment; the person clicking it has no way to read it
 * first, and the app it opens is already signed in. That is the same threat
 * `safe-redirect.ts` handles for `?next=`, arriving through the operating system instead
 * of the browser, and it is worse in one way: a browser at least shows the URL bar. So
 * `parseDeepLink` is an **allow-list of shapes**, not a parser that tries to reject bad
 * ones — a target it does not recognise is refused, and refusing an unfamiliar link costs
 * a user one navigation while accepting one costs them their session.
 *
 * Pure: no Tauri import, no `window`, no fetch. The native calls belong to the caller;
 * this says what to do with what they return, which is also why it is testable at all.
 *
 * No runtime dependency added — the doctrine is three.
 */

/** The scheme the installer registers. One, lowercase, no alternatives. */
export const SCHEME = "kryova:";

/**
 * Where a deep link is allowed to land.
 *
 * Deliberately a short closed set of *read* destinations. Nothing here performs an action:
 * a link that ran a simulation, accepted an invitation or deleted anything would be a
 * one-click cross-site request with no origin check between it and the user's session.
 * Opening a page and letting the user press the button is the whole mitigation.
 */
export type DeepLinkTarget =
  | { readonly kind: "run"; readonly simulationId: string }
  | { readonly kind: "conversation"; readonly conversationId: string }
  | { readonly kind: "project"; readonly projectId: string };

/** Why a link was refused. Kept specific so the UI can say something true. */
export type DeepLinkRefusal =
  | "not-a-kryova-link"
  | "unknown-target"
  | "malformed-id"
  | "extra-path";

export type DeepLinkResult =
  | { readonly ok: true; readonly target: DeepLinkTarget; readonly path: string }
  | { readonly ok: false; readonly refusal: DeepLinkRefusal };

/**
 * Ids are opaque to this module, so the rule is a shape rule rather than a format rule.
 *
 * Hex, dashes and underscores, bounded. It admits every id this product mints (UUIDs and
 * the slug ids) and admits nothing that could be a path, a scheme, a query or a control
 * character — which is the only property being relied on, since the id goes into a URL
 * this app then navigates to.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const TARGETS: Readonly<Record<string, DeepLinkTarget["kind"]>> = {
  run: "run",
  conversation: "conversation",
  project: "project",
};

/**
 * Read a `kryova://` URL into a destination, or refuse it.
 *
 * **Allow-list, never deny-list.** Only `kryova://run/<id>`, `kryova://conversation/<id>`
 * and `kryova://project/<id>` are accepted, each with exactly one segment after the target
 * word. Everything else is refused by name.
 */
export function parseDeepLink(raw: string): DeepLinkResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, refusal: "not-a-kryova-link" };
  }

  // `URL` lowercases the protocol, so no case folding is needed here and adding one
  // would suggest the check is looser than it is.
  if (url.protocol !== SCHEME) return { ok: false, refusal: "not-a-kryova-link" };

  // `kryova://run/abc` parses with host "run" and pathname "/abc"; `kryova:/run/abc` with
  // an empty host and "/run/abc". Both spellings occur in the wild -- an email client may
  // normalise one into the other -- so the segments are read from the two joined rather
  // than from either alone.
  const segments = [url.host, ...url.pathname.split("/")].filter((one) => one !== "");
  if (segments.length === 0) return { ok: false, refusal: "unknown-target" };

  const kind = TARGETS[segments[0].toLowerCase()];
  if (kind === undefined) return { ok: false, refusal: "unknown-target" };
  if (segments.length > 2) return { ok: false, refusal: "extra-path" };
  if (segments.length < 2) return { ok: false, refusal: "malformed-id" };

  // Decoded before it is tested, or `%2e%2e%2f` passes a check that `../` would fail.
  let id: string;
  try {
    id = decodeURIComponent(segments[1]);
  } catch {
    return { ok: false, refusal: "malformed-id" };
  }
  if (!ID.test(id)) return { ok: false, refusal: "malformed-id" };

  switch (kind) {
    case "run":
      return { ok: true, target: { kind, simulationId: id }, path: `/dashboard/simulations/${id}` };
    case "conversation":
      return { ok: true, target: { kind, conversationId: id }, path: `/dashboard/chat/${id}` };
    case "project":
      return { ok: true, target: { kind, projectId: id }, path: `/dashboard/projects/${id}` };
  }
}

/** A sentence for a link the app declined to follow. */
export function refusalMessage(refusal: DeepLinkRefusal): string {
  switch (refusal) {
    case "not-a-kryova-link":
      return "That link is not a Kryova link, so nothing was opened.";
    case "unknown-target":
      return "That Kryova link points at something this version does not know how to open.";
    case "malformed-id":
      return "That Kryova link does not name anything Kryova can open.";
    case "extra-path":
      return "That Kryova link has more in it than a single item, so it was not followed.";
  }
}

// -- OS notifications --------------------------------------------------------

/**
 * Whether a finished job is worth an OS notification.
 *
 * **Only when the user has stopped waiting for it**, which is the whole of "used
 * sparingly". A notification for something the user is watching on screen is noise, and
 * an app that produces noise gets its notifications switched off at the OS level — after
 * which the one that mattered never arrives either. So the bar is: the window is not
 * focused, *and* the run took long enough that nobody sat through it.
 */
export const WORTH_INTERRUPTING_MS = 30_000;

export interface RunOutcome {
  readonly id: string;
  readonly label: string;
  /** `succeeded`, `failed` or `cancelled` — a cancellation is never notified. */
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly elapsedMs: number;
}

export interface NotificationDecision {
  readonly notify: boolean;
  readonly title: string;
  readonly body: string;
  /** Why not, when not — for a log, never for the user. */
  readonly skipped: string;
}

export function notificationFor(
  outcome: RunOutcome,
  windowFocused: boolean,
): NotificationDecision {
  const silent = (skipped: string): NotificationDecision => ({
    notify: false,
    title: "",
    body: "",
    skipped,
  });

  // A cancellation is the user's own doing, seconds ago, deliberately. Telling them about
  // it is telling them what they just did.
  if (outcome.status === "cancelled") return silent("the user cancelled it themselves");
  if (windowFocused) return silent("the window is focused, so the user can already see it");
  if (outcome.elapsedMs < WORTH_INTERRUPTING_MS) {
    return silent("it finished quickly enough that nobody walked away");
  }

  const succeeded = outcome.status === "succeeded";
  return {
    notify: true,
    title: succeeded ? "Simulation finished" : "Simulation failed",
    // No result number in the body. A stress figure with no mesh, material or load case
    // beside it is exactly the unqualified number `app/verify/` exists to prevent, and a
    // notification has no room for the qualification.
    body: succeeded
      ? `${outcome.label} has finished. Open Kryova to see the result.`
      : `${outcome.label} did not finish. Open Kryova to see why.`,
    skipped: "",
  };
}

// -- Local files -------------------------------------------------------------

/**
 * What the desktop file picker is allowed to hand to the attachment pipeline.
 *
 * The same set the web upload accepts, deliberately: a file that works on the desktop and
 * is refused in the browser is a product that behaves differently depending on how it was
 * opened, and the user has no way to know which they are in.
 */
export const OPENABLE_EXTENSIONS: readonly string[] = [
  "step", "stp", "iges", "igs", "stl", "brep",
  "pdf", "txt", "md", "csv",
  "xlsx", "docx", "pptx",
  "png", "jpg", "jpeg",
  "kreq",
] as const;

export type FileRefusal = "no-extension" | "unsupported-type" | "too-large" | "empty";

/** 200 MB, matching the chunked uploader's own ceiling. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export interface LocalFile {
  readonly path: string;
  readonly bytes: number;
}

export type FileVerdict =
  | { readonly ok: true; readonly name: string; readonly extension: string }
  | { readonly ok: false; readonly refusal: FileRefusal; readonly message: string };

/**
 * Whether a file chosen from the OS picker may enter the attachment pipeline.
 *
 * Checked here rather than only at upload so the refusal arrives while the picker is still
 * in mind, instead of after a 200 MB read. It is **not** a security boundary — the server
 * validates independently, and `app/documents/` treats every byte as untrusted whatever
 * this said.
 */
export function openable(file: LocalFile): FileVerdict {
  // Both separators: a Windows path reaches this on the platform the product ships on, and
  // splitting on "/" alone would treat "C:\\parts\\bracket.step" as one nameless segment.
  const name = file.path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");

  // `dot < 1` and not `dot === -1`: a dotfile is all extension and no name.
  if (dot < 1) {
    return {
      ok: false,
      refusal: "no-extension",
      message: `${name || file.path} has no file extension, so Kryova cannot tell what it is.`,
    };
  }
  const extension = name.slice(dot + 1).toLowerCase();
  if (!OPENABLE_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      refusal: "unsupported-type",
      message: `Kryova does not read .${extension} files. It reads ${OPENABLE_EXTENSIONS.slice(0, 6).join(", ")} and others.`,
    };
  }
  if (file.bytes <= 0) {
    return { ok: false, refusal: "empty", message: `${name} is empty.` };
  }
  if (file.bytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      refusal: "too-large",
      message: `${name} is larger than the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit.`,
    };
  }
  return { ok: true, name, extension };
}
