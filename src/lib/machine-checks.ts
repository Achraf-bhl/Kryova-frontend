import type { AIStatus } from "@/types/api";
import { isLocalKernel, type CatiaStatus } from "@/types/catia";

/**
 * What the setup page and the first-run checklist say about *this machine* (ROAD_TO_10 8.10).
 *
 * Every row is read from an answer the server already gives — `/health` (the database and the
 * media store), `/ai/status`, `/catia/status` — and a row says only what that answer says. Two
 * consequences worth stating:
 *
 * * **"Model configured", never "model key valid".** The status route reports whether a provider
 *   is set up; whether the key is *accepted* is known only when a message is sent. Printing
 *   "valid" would be a tick the checklist cannot back, which is the failure its first-run
 *   sibling is built to avoid.
 * * **A check that could not be read is `unknown`, not `problem`.** A failed fetch of
 *   `/ai/status` does not mean the model is broken, and telling a user to fix something that
 *   may be fine is worse than saying nothing.
 */

export type CheckState = "ok" | "problem" | "note" | "unknown";

export interface CheckRow {
  id: string;
  label: string;
  state: CheckState;
  /** What was found, in words. */
  detail: string;
  /** What to do, only when there is something to do. */
  fix?: string;
}

/** The body of `GET /health`. */
export interface HealthBody {
  status?: string;
  checks?: Record<string, string>;
}

export function interpretHealth(body: HealthBody | null): CheckRow[] {
  const rows: [string, string, string][] = [
    ["database", "Database (PostgreSQL)", "Accounts, projects and results are stored here."],
    ["media_store", "File storage", "Uploaded geometry and rendered results are kept here."],
  ];
  return rows.map(([key, label, purpose]) => {
    const answer = body?.checks?.[key];
    if (answer === undefined) {
      return {
        id: key,
        label,
        state: "unknown" as const,
        detail: "The server did not report on this.",
      };
    }
    if (answer === "ok") return { id: key, label, state: "ok" as const, detail: purpose };
    return {
      id: key,
      label,
      state: "problem" as const,
      detail: answer,
      fix: "Start it, or check the connection settings, then run the checks again.",
    };
  });
}

export function interpretMachine(input: {
  ai: AIStatus | null;
  catia: CatiaStatus | null;
}): CheckRow[] {
  const { ai, catia } = input;
  const rows: CheckRow[] = [];

  if (ai === null) {
    rows.push({ id: "model", label: "Model", state: "unknown", detail: "Could not be read." });
  } else if (ai.enabled) {
    rows.push({
      id: "model",
      label: "Model",
      state: "ok",
      detail: `${ai.provider} · ${ai.model} is configured. Whether its key is accepted shows on the first message.`,
    });
  } else {
    rows.push({
      id: "model",
      label: "Model",
      state: "problem",
      detail: ai.detail ?? "No model is configured.",
      fix: "Set AI_PROVIDER, AI_MODEL and AI_API_KEY in the backend's .env.local, then restart it.",
    });
  }

  if (catia === null) {
    rows.push({
      id: "geometry",
      label: "Where parts are built",
      state: "unknown",
      detail: "Could not be read.",
    });
    return rows;
  }

  if (isLocalKernel(catia)) {
    rows.push({
      id: "geometry",
      label: "Where parts are built",
      state: "ok",
      detail: `The open geometry kernel (${catia.backend_version}) builds parts here, with no CATIA seat.`,
    });
    return rows;
  }

  if (!catia.connected) {
    rows.push({
      id: "bridge",
      label: "CATIA workstation bridge",
      state: "problem",
      detail: catia.detail,
      fix:
        catia.paired_devices === 0
          ? "Pair a workstation under Settings, then start CATIA on it."
          : "A workstation is paired but offline: start CATIA and the bridge on it.",
    });
  } else if (catia.mock) {
    rows.push({
      id: "bridge",
      label: "CATIA workstation bridge",
      state: "note",
      detail: `${catia.device_name} is connected in simulator mode — no real CATIA behind it.`,
    });
  } else {
    rows.push({
      id: "bridge",
      label: "CATIA workstation bridge",
      state: "ok",
      detail: `${catia.device_name} is connected, running CATIA ${catia.catia_version}.`,
    });
  }
  return rows;
}

/** The base the health route hangs off: the API's origin, not its `/api/v1` prefix. */
export function healthUrl(apiBaseUrl: string): string {
  try {
    return `${new URL(apiBaseUrl).origin}/health`;
  } catch {
    return `${apiBaseUrl.replace(/\/api\/v\d+\/?$/, "").replace(/\/$/, "")}/health`;
  }
}

export const FIRST_PROMPT =
  "Make a 100 × 50 × 10 mm steel plate with one Ø12 mm hole in the middle, then check it under a 2 kN load.";

/**
 * A first message worth sending — offered only when both things it needs (a model, and
 * somewhere to build) are known to be there. Suggesting a prompt that cannot work sends a
 * new user into the failure the checks just spared them.
 */
export function firstPrompt(rows: CheckRow[]): string | null {
  const need = ["model", "geometry", "bridge"];
  const relevant = rows.filter((row) => need.includes(row.id));
  const model = relevant.find((row) => row.id === "model");
  const builder = relevant.find((row) => row.id === "geometry" || row.id === "bridge");
  if (!model || model.state !== "ok") return null;
  if (!builder || (builder.state !== "ok" && builder.state !== "note")) return null;
  return FIRST_PROMPT;
}
