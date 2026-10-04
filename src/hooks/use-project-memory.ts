"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api-client";
import type { ProjectMemoryRead } from "@/types/api";

/**
 * A project's remembered facts, and the four things a person can do to them
 * (ROAD_TO_10 2.7).
 *
 * **Every action waits for the server.** A fact is something the model will be told in
 * every conversation of the project, so showing it as kept before it is would be a
 * small lie about what the assistant knows; the list is replaced by what the server
 * answered, never patched optimistically. A refusal (the project's limit, a duplicate,
 * a viewer's 404) is returned as words for the caller to put beside the control, not
 * thrown into an error boundary.
 */

export type MemoryLoad =
  | { kind: "loading" }
  | { kind: "ready"; items: ProjectMemoryRead[]; limit: number }
  | { kind: "failed"; message: string };

export interface ProjectMemoryController {
  state: MemoryLoad;
  /** Resolves to the refusal in words, or `null` when it worked. */
  add: (text: string) => Promise<string | null>;
  edit: (id: string, text: string) => Promise<string | null>;
  confirm: (id: string) => Promise<string | null>;
  forget: (id: string) => Promise<string | null>;
}

function wordsFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function useProjectMemory(projectId: string, revision = 0): ProjectMemoryController {
  const [state, setState] = useState<MemoryLoad>({ kind: "loading" });

  useEffect(() => {
    // Promise callbacks rather than `await` in the effect body: the lint here refuses a
    // `setState` it can trace to an effect, and `cancelled` keeps a late answer for a
    // project the user has left from writing into the next one.
    let cancelled = false;
    api
      .listProjectMemory(projectId)
      .then((page) => {
        if (!cancelled) setState({ kind: "ready", items: page.items, limit: page.limit });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ kind: "failed", message: wordsFor(error, "The project's memory could not be read.") });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, revision]);

  /** Re-read after a write, so what is shown is what the server holds. */
  const reload = useCallback(async () => {
    const page = await api.listProjectMemory(projectId);
    setState({ kind: "ready", items: page.items, limit: page.limit });
  }, [projectId]);

  const run = useCallback(
    async (action: () => Promise<unknown>, fallback: string): Promise<string | null> => {
      try {
        await action();
      } catch (error) {
        return wordsFor(error, fallback);
      }
      try {
        await reload();
      } catch (error) {
        // The write landed and the re-read did not: say the second thing, because the
        // list on screen is now the stale one.
        return wordsFor(error, "Saved, but the list could not be refreshed. Reload the page.");
      }
      return null;
    },
    [reload],
  );

  return {
    state,
    add: (text) => run(() => api.addProjectMemory(projectId, text), "That could not be saved."),
    edit: (id, text) =>
      run(() => api.editProjectMemory(projectId, id, text), "That could not be changed."),
    confirm: (id) =>
      run(() => api.confirmProjectMemory(projectId, id), "That could not be confirmed."),
    forget: (id) =>
      run(() => api.forgetProjectMemory(projectId, id), "That could not be removed."),
  };
}
