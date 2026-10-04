/**
 * What works without the backend, stated rather than discovered by timeout — P7 task 4.
 *
 * **"Does this work offline" is a fact somebody knows when they build the feature and
 * nobody can infer afterwards.** So it is a table written in advance, not a guess made at
 * the call site — one table, not one decision per screen, because per-screen decisions are
 * how two screens come to disagree about the same feature and the user meets both.
 *
 * **A capability the table does not list reads as unavailable.** Defaulting a missing row
 * to "works offline" would turn forgetting to add one into a promise the app cannot keep,
 * which is the exact failure this module exists to remove.
 *
 * Three states that are usually collapsed into one, and are kept apart here:
 *
 * - **`unknown` is the startup state and is not offline.** Before the first probe the
 *   honest position is that the backend is probably fine; greying the interface out on
 *   launch would make every cold start look like an outage.
 * - **`unreachable` and `failing` get different sentences.** "No connection" invites
 *   checking the network; "the server is having trouble" invites waiting. Swapping them
 *   wastes the user's time in both directions.
 * - **`cached` is enabled *and marked degraded*,** so a short list cannot read as the
 *   whole list. "Your last three designs" is honest; an empty list captioned "designs" is
 *   not.
 *
 * Two readings that look obvious and are wrong:
 *
 * - **`navigator.onLine` is a fast negative only.** It is `true` on a captive-portal wifi
 *   that reaches nothing, so it can say "definitely offline" and never "definitely fine".
 * - **A 401 or a 404 is not offline.** The server is up and answering correctly about
 *   something else, and switching the whole interface off because one probe was
 *   unauthorised is the obvious wrong reading. Only a 5xx is `failing`.
 *
 * **Nothing is queued for later, and the refusals say so.** An offline queue is a real
 * feature with real consequences — a design edit replayed against a part that moved
 * underneath — and pretending to accept a write is worse than refusing it.
 *
 * Rebuilt 2026-09-17. The master plan claimed this module on 2026-09-16 and it had never
 * been committed; the design above is what that status recorded, and it is the reason the
 * status was worth keeping even though its claim was false.
 */

/** How the backend looked at the last probe. */
export type BackendState = "unknown" | "online" | "unreachable" | "failing";

/** What a capability can do in the current state. */
export type Availability = "available" | "degraded" | "unavailable";

/** What a capability needs in order to work. */
export type Requirement =
  /** Works with no backend at all. */
  | "none"
  /** Works from what the client already holds, and is incomplete without the server. */
  | "cache"
  /** Needs the server. */
  | "server";

export interface Capability {
  readonly id: string;
  /** What a user would call it. */
  readonly label: string;
  readonly requires: Requirement;
  /** Why it needs what it needs, in one clause. Shown when a control is disabled. */
  readonly because: string;
}

/**
 * Every capability the app offers, and what each needs. Ten rows.
 *
 * Written in advance and in one place. A feature added without a row here is
 * `unavailable` whenever the backend is not known-good, which is the safe direction: a
 * control the user cannot press is a nuisance, and one that silently fails is a bug
 * report about something else.
 */
export const CAPABILITIES: readonly Capability[] = [
  {
    id: "view-cached-design",
    label: "View a design you already opened",
    requires: "cache",
    because: "the design is in this browser; anything newer is on the server",
  },
  {
    id: "read-docs",
    label: "Read the handbook",
    requires: "none",
    because: "the handbook ships with the app",
  },
  {
    id: "view-cached-results",
    label: "View results you already opened",
    requires: "cache",
    because: "the fields are in this browser; the run history is on the server",
  },
  {
    id: "chat",
    label: "Ask the agent",
    requires: "server",
    because: "the model runs on the server",
  },
  {
    id: "run-simulation",
    label: "Run a simulation",
    requires: "server",
    because: "meshing and solving happen on the server",
  },
  {
    id: "upload-geometry",
    label: "Upload geometry",
    requires: "server",
    because: "the file is stored on the server",
  },
  {
    id: "edit-parameter",
    label: "Change a design parameter",
    requires: "server",
    because: "the change is compiled and recorded on the server",
  },
  {
    id: "browse-projects",
    label: "Browse your projects",
    requires: "server",
    because: "the project list is on the server",
  },
  {
    id: "catia-bridge",
    label: "Drive CATIA",
    requires: "server",
    because: "the bridge is dialled from the server",
  },
  {
    id: "export",
    label: "Export STEP or a drawing",
    requires: "server",
    because: "the export is produced on the server",
  },
] as const;

const BY_ID = new Map(CAPABILITIES.map((capability) => [capability.id, capability]));

/** Whether the backend is known to be unusable. `unknown` is not. */
export function isDown(state: BackendState): boolean {
  return state === "unreachable" || state === "failing";
}

/**
 * What `id` can do right now.
 *
 * An unknown id is `unavailable`, deliberately: see the module docstring. It is not an
 * exception, because a missing row must not be able to take a screen down.
 */
export function availability(id: string, state: BackendState): Availability {
  const capability = BY_ID.get(id);
  if (capability === undefined) return "unavailable";
  if (capability.requires === "none") return "available";
  if (!isDown(state)) return "available";
  return capability.requires === "cache" ? "degraded" : "unavailable";
}

/** The sentence to show when a capability is not fully available, or `null` when it is. */
export function explain(id: string, state: BackendState): string | null {
  const capability = BY_ID.get(id);
  if (capability === undefined) {
    return "This is not something the app knows how to do offline, so it is switched off.";
  }
  const verdict = availability(id, state);
  if (verdict === "available") return null;
  const cause =
    state === "unreachable"
      ? "Nothing answered, so the connection is the first thing to check."
      : "The server is having trouble. Waiting is usually the right move.";
  if (verdict === "degraded") {
    return `Showing what this browser already has — ${capability.because}. ${cause}`;
  }
  return `Not available: ${capability.because}. ${cause} Nothing is queued to run later.`;
}

/**
 * Read a probe into a state.
 *
 * `status` is the HTTP status the probe came back with, or `null` if nothing answered.
 * Only a 5xx is `failing`: a 401 or a 404 means the server is up and answering correctly
 * about something else.
 */
export function stateFromProbe(status: number | null, onLine = true): BackendState {
  if (!onLine) return "unreachable";
  if (status === null) return "unreachable";
  if (status >= 500) return "failing";
  return "online";
}

export interface OfflineSummary {
  readonly state: BackendState;
  readonly unavailable: number;
  readonly degraded: number;
  readonly total: number;
  /** The one line a banner shows, or `null` when there is nothing to say. */
  readonly banner: string | null;
}

/**
 * What the banner says. **Counts, never adjectives.**
 *
 * "7 of 10 features need the server" is checkable by the person reading it; "limited
 * functionality" is not, and leaves them to find out which parts by pressing things.
 */
export function summarise(state: BackendState): OfflineSummary {
  const verdicts = CAPABILITIES.map((capability) => availability(capability.id, state));
  const unavailable = verdicts.filter((verdict) => verdict === "unavailable").length;
  const degraded = verdicts.filter((verdict) => verdict === "degraded").length;
  const total = CAPABILITIES.length;
  if (!isDown(state) || unavailable + degraded === 0) {
    return { state, unavailable, degraded, total, banner: null };
  }
  const head =
    state === "unreachable"
      ? "No connection to Kryova."
      : "Kryova's server is having trouble.";
  const degradedClause = degraded > 0 ? `, and ${degraded} show only what is cached` : "";
  return {
    state,
    unavailable,
    degraded,
    total,
    banner: `${head} ${unavailable} of ${total} features need the server${degradedClause}. Nothing is queued to run later.`,
  };
}
