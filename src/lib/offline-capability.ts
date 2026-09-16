/**
 * What still works with no backend, said out loud rather than discovered by timeout (P7.4).
 *
 * The desktop app launches, paints a full interface and then — if the backend is not
 * reachable — every button fails one at a time, each after its own timeout, each with its
 * own shrug. The user learns what is broken by trying things for two minutes. That is the
 * behaviour this module exists to replace.
 *
 * **The honest version is a table written in advance**, because "does this work offline"
 * is a fact about each feature that somebody knows when they build it and nobody can infer
 * afterwards. `CAPABILITIES` below is that table. A feature not in it is
 * `unknownCapability`, which reads as *unavailable*, never as available — a missing entry
 * must not silently grant an offline promise the code cannot keep.
 *
 * Three things this deliberately does **not** do:
 *
 * * **It does not queue writes for later.** An offline queue is a real feature with real
 *   consequences (a design edit replayed against a part that moved underneath), and
 *   pretending to accept a write is worse than refusing it. Nothing here defers anything.
 * * **It does not use `navigator.onLine` as the answer.** That flag says the machine has
 *   *a* network, not that Kryova's backend is reachable — a laptop on a café wifi with a
 *   captive portal is `true` and can reach nothing. It is used only as a fast negative:
 *   `false` is conclusive, `true` proves nothing and still needs a probe.
 * * **It does not guess from one failed request.** A single 500 is the server having a bad
 *   moment; `Reachability` distinguishes *unreachable* from *failing*, because the sentence
 *   a user needs is different for each.
 *
 * Pure. No fetch, no React, no timers: the caller probes and hands the result in.
 *
 * No runtime dependency added — the doctrine is three.
 */

/**
 * What the app has most recently established about the backend.
 *
 * `unknown` is the startup state and is not a synonym for offline: the app has not asked
 * yet, and telling a user "you are offline" before trying is its own wrong answer.
 */
export type Reachability =
  | { readonly state: "unknown" }
  | { readonly state: "online" }
  /** Nothing answered: DNS, connection refused, timeout, or `navigator.onLine === false`. */
  | { readonly state: "unreachable"; readonly since: number }
  /** Something answered, badly. The backend exists and is unwell — a different sentence. */
  | { readonly state: "failing"; readonly status: number; readonly since: number };

export const UNKNOWN_REACHABILITY: Reachability = { state: "unknown" };

/** Whether the backend is known to be usable right now. `unknown` is not. */
export function isUsable(reachability: Reachability): boolean {
  return reachability.state === "online";
}

/**
 * How a capability behaves when the backend is gone.
 *
 * `cached` is the interesting one and the one that must not be overclaimed: it means the
 * feature works **only** for data already on this machine, and the UI has to say which.
 * "Your last three designs" is honest; an empty list captioned "designs" is not.
 */
export type OfflineBehaviour = "works" | "cached" | "unavailable";

export interface Capability {
  readonly id: string;
  /** What a user would call it. */
  readonly label: string;
  readonly offline: OfflineBehaviour;
  /**
   * The sentence shown when the backend is unreachable. Says what the user can do, not
   * what the software cannot — `errors are human-readable and actionable` is a project
   * rule and it applies hardest here, where the user is already stuck.
   */
  readonly whenOffline: string;
}

/**
 * Every capability the desktop shell exposes, and what each does with no backend.
 *
 * Kept as one table on purpose. The alternative — each screen deciding for itself — is how
 * two screens come to disagree about whether the same feature works, and the user meets
 * both.
 */
export const CAPABILITIES: readonly Capability[] = [
  {
    id: "read-handbook",
    label: "Documentation and guides",
    offline: "works",
    whenOffline: "The handbook is bundled with the app and reads normally.",
  },
  {
    id: "view-cached-design",
    label: "Designs you have already opened",
    offline: "cached",
    whenOffline:
      "You can read designs already downloaded to this machine. Anything you have not opened before is not here.",
  },
  {
    id: "view-cached-geometry",
    label: "3D views you have already loaded",
    offline: "cached",
    whenOffline:
      "Meshes already downloaded still draw. Changing the detail level fetches, so it will not work.",
  },
  {
    id: "chat",
    label: "Asking the agent",
    offline: "unavailable",
    whenOffline:
      "The agent runs on the server. Reconnect to carry on the conversation — nothing you have already said is lost.",
  },
  {
    id: "run-simulation",
    label: "Running a simulation",
    offline: "unavailable",
    whenOffline:
      "Solving happens on the server. Queue it once you are reconnected; nothing is held for later.",
  },
  {
    id: "edit-design",
    label: "Changing a design parameter",
    offline: "unavailable",
    whenOffline:
      "A change is compiled and checked on the server, so it cannot be made here. It is not saved for later either — make it again when you reconnect.",
  },
  {
    id: "upload-attachment",
    label: "Attaching a file",
    offline: "unavailable",
    whenOffline: "Uploads go to the server. The file is untouched; attach it again later.",
  },
  {
    id: "catia-bridge",
    label: "Driving the CATIA seat",
    offline: "unavailable",
    whenOffline:
      "The bridge is paired through the server, so the seat cannot be driven while it is unreachable — even though CATIA is on this machine.",
  },
  {
    id: "export",
    label: "Exporting STEP, DXF or a drawing",
    offline: "unavailable",
    whenOffline: "Exports are written by the server from the authoritative geometry.",
  },
  {
    id: "sign-in",
    label: "Signing in or out",
    offline: "unavailable",
    whenOffline:
      "Signing in needs the server. You stay signed in here until your session expires.",
  },
] as const;

const BY_ID = new Map(CAPABILITIES.map((one) => [one.id, one]));

/**
 * The entry for a capability the table does not list.
 *
 * **Unavailable, not available.** A feature nobody classified is a feature nobody checked,
 * and defaulting it to "works offline" would make forgetting to add a row into a promise
 * the app cannot keep — the exact failure this module was written to remove.
 */
export function unknownCapability(id: string): Capability {
  return {
    id,
    label: id,
    offline: "unavailable",
    whenOffline:
      "This part of Kryova has not been checked for offline use, so it is treated as needing the server.",
  };
}

export function capability(id: string): Capability {
  return BY_ID.get(id) ?? unknownCapability(id);
}

/** What the UI should do with one capability given what is known about the backend. */
export interface CapabilityVerdict {
  readonly capability: Capability;
  /** Whether to let the user start it at all. */
  readonly enabled: boolean;
  /** Why not, when not. Empty when enabled. */
  readonly reason: string;
  /**
   * True when it is allowed but will show less than usual — a cached view. The UI owes the
   * user a marker here; without one, a short list reads as the whole list.
   */
  readonly degraded: boolean;
}

/**
 * Whether a capability can be used, and what to say when it cannot.
 *
 * **`unknown` reachability enables everything.** Before the first probe the honest
 * position is that the backend is probably fine, and greying the interface out on startup
 * would make every cold launch look like an outage. A request made under `unknown` that
 * fails is what moves the state — which is the normal, correct order.
 */
export function verdictFor(id: string, reachability: Reachability): CapabilityVerdict {
  const found = capability(id);

  if (reachability.state === "online" || reachability.state === "unknown") {
    return { capability: found, enabled: true, reason: "", degraded: false };
  }

  // `failing` and `unreachable` differ in what the user should do, so they differ in what
  // they are told. "The server is having trouble" invites waiting; "no connection" invites
  // checking the network. Swapping them wastes the user's time in both directions.
  const context =
    reachability.state === "failing"
      ? `Kryova's server answered with an error (${reachability.status}).`
      : "Kryova's server cannot be reached from this machine.";

  if (found.offline === "works") {
    return { capability: found, enabled: true, reason: "", degraded: false };
  }
  if (found.offline === "cached") {
    return {
      capability: found,
      enabled: true,
      reason: `${context} ${found.whenOffline}`,
      degraded: true,
    };
  }
  return {
    capability: found,
    enabled: false,
    reason: `${context} ${found.whenOffline}`,
    degraded: false,
  };
}

/** Every capability's verdict, for a status panel that lists the whole picture at once. */
export function allVerdicts(
  reachability: Reachability,
): readonly CapabilityVerdict[] {
  return CAPABILITIES.map((one) => verdictFor(one.id, reachability));
}

/**
 * One sentence for the banner across the top of the app.
 *
 * Counts rather than adjectives: "6 of 10 features need the server" is checkable and
 * "limited functionality" is not.
 */
export function bannerFor(reachability: Reachability): string | null {
  if (reachability.state === "online" || reachability.state === "unknown") return null;

  const verdicts = allVerdicts(reachability);
  const blocked = verdicts.filter((one) => !one.enabled).length;
  const lead =
    reachability.state === "failing"
      ? `Kryova's server is answering with errors (${reachability.status}).`
      : "No connection to Kryova's server.";

  return `${lead} ${blocked} of ${verdicts.length} features need it and are switched off; the rest work from what is already on this machine.`;
}

/**
 * Read a probe into a reachability state.
 *
 * `status` is the HTTP status the probe got, or `null` when nothing answered at all —
 * which is the distinction the whole type exists for. `onLine` is `navigator.onLine`,
 * used only as a fast negative: see the module docstring.
 */
export function reachabilityFrom(
  status: number | null,
  now: number,
  onLine = true,
): Reachability {
  if (!onLine) return { state: "unreachable", since: now };
  if (status === null) return { state: "unreachable", since: now };
  // 5xx is the server being unwell. 4xx is not: a 401 or a 404 means the server is up and
  // answering correctly about something else, and calling that "offline" would switch the
  // whole interface off because one probe was unauthorised.
  if (status >= 500) return { state: "failing", status, since: now };
  return { state: "online" };
}
