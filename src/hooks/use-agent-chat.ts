"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentProgress, StepView } from "@/components/agent-step-list";
import { api } from "@/lib/api-client";
import type { Turn } from "@/lib/conversation-transcript";
import { resumeAgent, streamAgent, type CursoredEvent } from "@/lib/agent-stream";

/** What an auto-created project is named before the agent gets a chance to
 * rename it to something that fits what the user actually asked for. */
const UNTITLED_PROJECT_NAME = "New project";

export type { Turn };

export interface UseAgentChatOptions {
  /**
   * The conversation this chat is continuing, taken from the URL.
   *
   * It is a prop rather than internal state on purpose. This used to live in a
   * ref, so a refresh or a nav click lost the id while the transcript stayed on
   * the server — the conversation still existed and was simply unreachable.
   */
  conversationId?: string | null;
  /** Transcript rehydrated server-side, so the thread is there on first paint. */
  initialTurns?: Turn[];
  projectId?: string;
  defaultAllowMutations?: boolean;
  /** Fired once, when a brand-new conversation gets its id: put it in the URL. */
  onConversationStarted?: (conversationId: string) => void;
  onProjectCreated?: (projectId: string) => void;
  /** Fired after a turn settles, so a sidebar can pick up the new title. */
  onTurnFinished?: () => void;
}

let turnCounter = 0;
function nextTurnId(prefix: string): string {
  turnCounter += 1;
  return `${prefix}-${turnCounter}`;
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const {
    conversationId: conversationIdProp = null,
    initialTurns,
    projectId,
    defaultAllowMutations = false,
    onConversationStarted,
    onProjectCreated,
    onTurnFinished,
  } = options;

  const [turns, setTurns] = useState<Turn[]>(() => initialTurns ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowMutations, setAllowMutations] = useState(defaultAllowMutations);
  const [liveSteps, setLiveSteps] = useState<StepView[]>([]);
  /**
   * The loop's state for the turn in flight, null between turns.
   *
   * It survives a `tool_start` on purpose. It used to be cleared there, so the
   * panel's counter vanished for the whole duration of every tool call and
   * came back with a different number — a readout that blinks off during the
   * only part of a turn that takes real time. What `tool_start` actually means
   * is that the model has stopped composing, which is one field of this, not
   * the end of the turn.
   */
  const [thinking, setThinking] = useState<AgentProgress | null>(null);
  const [narration, setNarration] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(conversationIdProp);

  /**
   * A mirror of `liveSteps` that can be read synchronously.
   *
   * The `done` handler needs the current steps while also updating turns. It
   * used to get them by nesting `setTurns` inside a `setLiveSteps` updater —
   * an impure updater, which React may call twice, and which then appends the
   * same turn twice in development. Read the ref, write both states purely.
   */
  const liveStepsRef = useRef<StepView[]>([]);
  const updateSteps = useCallback((updater: (previous: StepView[]) => StepView[]) => {
    liveStepsRef.current = updater(liveStepsRef.current);
    setLiveSteps(liveStepsRef.current);
  }, []);

  /** True once this turn has produced an assistant message. */
  const answeredRef = useRef(false);
  /**
   * The message a retry would re-send. State rather than a ref because
   * `canRetry` is rendered — a ref read during render is exactly the value
   * React will not re-render for.
   */
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const reportedProjectRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Whether a stop has been asked for and not yet taken effect (P5.6).
   *
   * Both a ref and state on purpose: `stop` reads it to decide whether this is
   * the polite first press or the abort, and it must see the value set by the
   * press a moment ago rather than the one from the render it closed over. The
   * state is what the composer renders.
   */
  const stoppingRef = useRef(false);
  const [stopping, setStopping] = useState(false);

  /**
   * The last event cursor seen this turn, for a reconnect (P5.1).
   *
   * A ref, not state: nothing renders it, and it has to be readable by the
   * `catch` that fires the moment the connection drops — a state value there
   * would be whatever it was when `run` closed over it, which is zero.
   */
  const cursorRef = useRef(0);
  /**
   * The answer as it is being written, from `token` deltas.
   *
   * Cleared the moment the `message` event lands, because that event carries
   * the real text and this was only ever a preview of it. A provider that does
   * not stream emits no deltas at all, so this simply stays empty and the
   * answer appears whole — which is the honest rendering of "this provider does
   * not stream" rather than a fake typewriter over an answer already in hand.
   */
  const [streamingText, setStreamingText] = useState("");

  const onConversationStartedRef = useRef(onConversationStarted);
  const onProjectCreatedRef = useRef(onProjectCreated);
  const onTurnFinishedRef = useRef(onTurnFinished);
  useEffect(() => {
    onConversationStartedRef.current = onConversationStarted;
    onProjectCreatedRef.current = onProjectCreated;
    onTurnFinishedRef.current = onTurnFinished;
  }, [onConversationStarted, onProjectCreated, onTurnFinished]);

  /**
   * The id is seeded once and thereafter only moves when the backend mints one
   * mid-stream. There is no prop-sync effect on purpose: the conversation page
   * keys this hook's component by conversation id, so a *different* id means a
   * remount, and `/dashboard` only ever passes null.
   */
  const conversationIdRef = useRef<string | null>(conversationIdProp);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Fold this turn's steps into the answer it produced, and clear them. */
  const settleSteps = useCallback(
    (extra?: { truncated?: boolean; stopReason?: Turn["stopReason"]; error?: string }) => {
      const steps = liveStepsRef.current;
      updateSteps(() => []);
      if (steps.length === 0 && !extra?.error && !extra?.truncated) return;

      setTurns((previous) => {
        // Attach to the answer this turn produced — the last turn, which is
        // this run's assistant message. Scanning backwards for "the last
        // assistant turn" was the bug: a turn that ends without a message
        // hung its steps on the *previous* answer, rewriting history.
        const last = previous[previous.length - 1];
        if (answeredRef.current && last?.role === "assistant") {
          return [
            ...previous.slice(0, -1),
            {
              ...last,
              ...(steps.length > 0 ? { steps } : {}),
              ...(extra?.truncated ? { truncated: true } : {}),
              ...(extra?.stopReason ? { stopReason: extra.stopReason } : {}),
              ...(extra?.error ? { error: extra.error } : {}),
            },
          ];
        }
        return [
          ...previous,
          {
            id: nextTurnId("turn"),
            role: "assistant",
            content: "",
            ...(steps.length > 0 ? { steps } : {}),
            ...(extra?.truncated ? { truncated: true } : {}),
            ...(extra?.stopReason ? { stopReason: extra.stopReason } : {}),
            ...(extra?.error ? { error: extra.error } : {}),
          },
        ];
      });
    },
    [updateSteps],
  );

  const handleEvent = useCallback(
    (event: CursoredEvent) => {
      // The cursor for a reconnect. Recorded on every event that carries one —
      // the backend sends the event even when recording it failed, and a
      // missing `seq` means "cannot resume from here", so the last good one is
      // kept rather than overwritten with nothing.
      if (typeof event.seq === "number") cursorRef.current = event.seq;
      switch (event.type) {
        case "start":
          if (event.conversation_id && conversationIdRef.current !== event.conversation_id) {
            conversationIdRef.current = event.conversation_id;
            setConversationId(event.conversation_id);
            // The URL is the owner of this id; tell the page to put it there.
            onConversationStartedRef.current?.(event.conversation_id);
          }
          break;
        case "thinking":
          // `step`/`max_steps` are the loop's own round budget, not a position
          // in the step list below — carried under names that say so.
          setThinking({ composing: true, round: event.step, maxRounds: event.max_steps });
          break;
        case "narration":
          setNarration(event.content);
          break;
        case "tool_start":
          // The model has finished composing this round; the turn has not
          // finished. Keep the round budget, drop the "thinking" dots.
          setThinking((previous) => (previous ? { ...previous, composing: false } : previous));
          updateSteps((previous) => [
            ...previous,
            {
              id: event.id,
              tool: event.tool,
              label: event.label,
              arguments: event.arguments,
              status: "running",
            },
          ]);
          break;
        case "tool_end":
          updateSteps((previous) =>
            previous.map((step) =>
              step.id === event.id
                ? {
                    ...step,
                    status: event.ok ? ("ok" as const) : ("error" as const),
                    summary: event.summary,
                    durationMs: event.duration_ms,
                    result: event.result,
                  }
                : step,
            ),
          );
          break;
        case "token":
          // Deltas are for display while the answer is being written. The
          // `message` event that follows carries the real text and replaces
          // this — see `AgentEvent` for why concatenating them instead would be
          // a second copy that drifts.
          setStreamingText((previous) => previous + event.content);
          break;
        case "resume_gap":
        case "resume_idle":
          // The live events are gone or the turn went quiet. The transcript is
          // complete, so this is a reload rather than an error: saying "the
          // agent failed" about a turn that very likely succeeded is the worse
          // of the two wrong answers.
          setError(event.message);
          settleSteps({ error: event.message });
          setThinking(null);
          setNarration("");
          break;
        case "message":
          answeredRef.current = true;
          setStreamingText("");
          setTurns((previous) => [
            ...previous,
            { id: nextTurnId("assistant"), role: "assistant", content: event.content },
          ]);
          break;
        case "done":
          if (event.conversation_id && conversationIdRef.current !== event.conversation_id) {
            conversationIdRef.current = event.conversation_id;
            setConversationId(event.conversation_id);
            onConversationStartedRef.current?.(event.conversation_id);
          }
          if (event.project_id && reportedProjectRef.current !== event.project_id) {
            reportedProjectRef.current = event.project_id;
            onProjectCreatedRef.current?.(event.project_id);
          }
          setStreamingText("");
          settleSteps({
            truncated: event.truncated,
            // Only carried for the two unfinished exits; "finished" would
            // never be read, because the banner is behind `truncated`.
            ...(event.stop_reason === "step_budget" ||
            event.stop_reason === "repeated_calls" ||
            event.stop_reason === "cancelled"
              ? { stopReason: event.stop_reason }
              : {}),
          });
          setThinking(null);
          setNarration("");
          break;
        case "error":
          // A step left saying "running" forever is a lie about a CATIA
          // operation that may well have half-happened. Fail them explicitly.
          updateSteps((previous) =>
            previous.map((step) =>
              step.status === "running"
                ? { ...step, status: "error" as const, summary: "Interrupted" }
                : step,
            ),
          );
          setError(event.message);
          settleSteps({ error: event.message });
          setThinking(null);
          setNarration("");
          break;
      }
    },
    [settleSteps, updateSteps],
  );

  const run = useCallback(
    async (message: string) => {
      setError(null);
      answeredRef.current = false;
      setLastMessage(message);
      updateSteps(() => []);
      setStreamingText("");
      // A fresh turn resumes from nothing: its own `start` event supplies the
      // first cursor. Carrying the previous turn's number forward would ask
      // the server for events it has already shown.
      cursorRef.current = 0;
      setBusy(true);

      // The first message of a brand-new conversation (no conversation id
      // minted yet, no project already scoped to it) gets an empty project
      // created up front, rather than leaving the model to call its own
      // create_project tool mid-turn. It still renames it -- see
      // _PROJECT_BOOTSTRAP -- so this only saves the round trip where a
      // conversation would otherwise run project-less. A conversation that is
      // being resumed (conversationIdRef already set) never goes through this:
      // it already has whatever project it has.
      let effectiveProjectId = projectId ?? null;
      if (!effectiveProjectId && !conversationIdRef.current) {
        try {
          const created = await api.createProject({ name: UNTITLED_PROJECT_NAME });
          effectiveProjectId = created.id;
          if (reportedProjectRef.current !== created.id) {
            reportedProjectRef.current = created.id;
            onProjectCreatedRef.current?.(created.id);
          }
        } catch {
          // No project this turn is the status quo this replaces -- fall back
          // to it rather than blocking the message on a project the agent can
          // still create itself.
        }
      }

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAgent(
          {
            message,
            conversation_id: conversationIdRef.current,
            project_id: effectiveProjectId,
            allow_mutations: allowMutations,
          },
          handleEvent,
          controller.signal,
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // Same reason the `error` event does it: a step frozen at "running"
          // in a settled turn claims a CATIA call is still in flight forever,
          // and it also leaves the counter reading "step 3" on a turn that
          // stopped. Stopping the stream does not stop the seat, so say
          // "stopped", not "failed".
          updateSteps((previous) =>
            previous.map((step) =>
              step.status === "running"
                ? { ...step, status: "error" as const, summary: "Stopped" }
                : step,
            ),
          );
          settleSteps({ error: "You stopped this run." });
        } else if (conversationIdRef.current && !answeredRef.current) {
          // The connection dropped on a turn that is very likely still running
          // on the server — the agent loop does not care that nobody is
          // listening. Rejoining from the cursor is the difference between
          // losing the live view and losing the turn. It is a `GET`: a POST
          // here would start a *second* turn, so a flaky connection would
          // double every message it interrupted.
          try {
            await resumeAgent(
              conversationIdRef.current,
              cursorRef.current,
              handleEvent,
              controller.signal,
            );
          } catch {
            const detail =
              err instanceof Error ? err.message : "The assistant could not be reached.";
            updateSteps((previous) =>
              previous.map((step) =>
                step.status === "running"
                  ? { ...step, status: "error" as const, summary: "Interrupted" }
                  : step,
              ),
            );
            setError(detail);
            settleSteps({ error: detail });
          }
        } else {
          const detail =
            err instanceof Error ? err.message : "The assistant could not be reached.";
          updateSteps((previous) =>
            previous.map((step) =>
              step.status === "running"
                ? { ...step, status: "error" as const, summary: "Interrupted" }
                : step,
            ),
          );
          setError(detail);
          settleSteps({ error: detail });
        }
      } finally {
        setBusy(false);
        setThinking(null);
        setNarration("");
        // However this turn ended — answered, stopped, aborted or failed — the
        // stop request that belonged to it is spent. Leaving it set would make
        // the next press of stop an immediate hard abort, which is the harsher
        // of the two behaviours arriving without the user asking for it.
        stoppingRef.current = false;
        setStopping(false);
        onTurnFinishedRef.current?.();
      }
    },
    [allowMutations, handleEvent, projectId, settleSteps, updateSteps],
  );

  const send = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || busy) return;
      setTurns((previous) => [
        ...previous,
        { id: nextTurnId("user"), role: "user", content: trimmed },
      ]);
      await run(trimmed);
    },
    [busy, run],
  );

  /** Re-run the last message after a failure, without retyping it. */
  const retry = useCallback(async () => {
    if (!lastMessage || busy) return;
    await run(lastMessage);
  }, [busy, lastMessage, run]);

  /**
   * Stop the running turn (P5.6). Two presses, two different things.
   *
   * The **first** asks the server to stop: the loop ends at its next step
   * boundary, writes "Stopped at your request" into the transcript and closes
   * the stream itself with `stop_reason: "cancelled"`. We keep listening,
   * because that is what turns a stop into a *clean* stop — the steps settle,
   * the message lands, and reopening the conversation shows what really ran.
   *
   * The **second** aborts the fetch, which is what this used to do on the
   * first press. It is kept as the escape hatch for a stream that has gone
   * quiet, and it is worse: it ends the stream and not the work. The agent on
   * the other side goes on driving a CATIA seat, and the hook's abort handler
   * has said exactly that in a comment since it was written — which is what
   * made the polite version worth building.
   *
   * With no conversation id there is nothing to address, so a first press is
   * the abort. That is only the very first turn, before the backend has minted
   * one.
   */
  const stop = useCallback(() => {
    const conversationId = conversationIdRef.current;
    if (!conversationId || stoppingRef.current) {
      abortRef.current?.abort();
      return;
    }
    stoppingRef.current = true;
    setStopping(true);
    // Deliberately not awaited and deliberately swallowed: a stop the server
    // never heard leaves the second press — a real abort — one click away, and
    // an error banner over a turn that is still running fine would be the
    // wrong thing on screen at the wrong moment.
    void api.cancelTurn(conversationId).catch(() => {});
  }, []);

  return {
    conversationId,
    turns,
    busy,
    error,
    /** True when there is a failed turn that `retry` would re-run. */
    canRetry: !busy && error !== null && lastMessage !== null,
    allowMutations,
    setAllowMutations,
    liveSteps,
    thinking,
    narration,
    /**
     * The answer arriving token by token (P5.1), empty when nothing is
     * streaming. Rendered *instead of* the finished message only while it is
     * non-empty; the `message` event clears it and supplies the real text.
     */
    streamingText,
    send,
    retry,
    stop,
    /**
     * A stop has been asked for and the turn has not ended yet (P5.6). The
     * composer says "stopping…" rather than swapping straight back to Send:
     * the gap is real — the loop finishes the tool call in flight first — and
     * a button that snapped back instantly would read as "nothing happened"
     * and get pressed again, which is the hard abort.
     */
    stopping,
  };
}
