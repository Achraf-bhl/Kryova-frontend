"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StepView } from "@/components/agent-step-list";
import type { Turn } from "@/lib/conversation-transcript";
import { streamAgent, type AgentEvent } from "@/lib/agent-stream";

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
  const [thinking, setThinking] = useState<{ step: number; maxSteps: number } | null>(null);
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
    (extra?: { truncated?: boolean; error?: string }) => {
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
            ...(extra?.error ? { error: extra.error } : {}),
          },
        ];
      });
    },
    [updateSteps],
  );

  const handleEvent = useCallback(
    (event: AgentEvent) => {
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
          setThinking({ step: event.step, maxSteps: event.max_steps });
          break;
        case "narration":
          setNarration(event.content);
          break;
        case "tool_start":
          setThinking(null);
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
        case "message":
          answeredRef.current = true;
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
          settleSteps({ truncated: event.truncated });
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
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAgent(
          {
            message,
            conversation_id: conversationIdRef.current,
            project_id: projectId ?? null,
            allow_mutations: allowMutations,
          },
          handleEvent,
          controller.signal,
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          settleSteps({ error: "You stopped this run." });
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

  const stop = useCallback(() => abortRef.current?.abort(), []);

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
    send,
    retry,
    stop,
  };
}
