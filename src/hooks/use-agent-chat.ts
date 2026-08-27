"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StepView } from "@/components/agent-step-list";
import { streamAgent, type AgentEvent } from "@/lib/agent-stream";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  steps?: StepView[];
  truncated?: boolean;
}

interface UseAgentChatOptions {
  projectId?: string;
  defaultAllowMutations?: boolean;
  onProjectCreated?: (projectId: string) => void;
}

export function useAgentChat(options: UseAgentChatOptions) {
  const { projectId, defaultAllowMutations = false, onProjectCreated } = options;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowMutations, setAllowMutations] = useState(defaultAllowMutations);
  const [liveSteps, setLiveSteps] = useState<StepView[]>([]);
  const [thinking, setThinking] = useState<{ step: number; maxSteps: number } | null>(null);
  const [narration, setNarration] = useState("");

  const conversationIdRef = useRef<string | null>(null);
  const reportedProjectRef = useRef<string | null>(null);
  const onProjectCreatedRef = useRef(onProjectCreated);

  useEffect(() => {
    onProjectCreatedRef.current = onProjectCreated;
  }, [onProjectCreated]);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "start":
        conversationIdRef.current = event.conversation_id;
        break;
      case "thinking":
        setThinking({ step: event.step, maxSteps: event.max_steps });
        break;
      case "narration":
        setNarration(event.content);
        break;
      case "tool_start":
        setThinking(null);
        setLiveSteps((prev) => [
          ...prev,
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
        setLiveSteps((prev) =>
          prev.map((step) =>
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
        setTurns((prev) => [...prev, { role: "assistant", content: event.content }]);
        break;
      case "done":
        conversationIdRef.current = event.conversation_id;
        if (event.project_id && !reportedProjectRef.current) {
          reportedProjectRef.current = event.project_id;
          onProjectCreatedRef.current?.(event.project_id);
        }
        setLiveSteps((steps) => {
          setTurns((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].role === "assistant") {
                next[i] = { ...next[i], steps, truncated: event.truncated };
                break;
              }
            }
            return next;
          });
          return [];
        });
        setThinking(null);
        setNarration("");
        break;
      case "error":
        setError(event.message);
        break;
    }
  }, []);

  const send = useCallback(
    async (message: string) => {
      if (!message || busy) return;
      setError(null);
      setTurns((prev) => [...prev, { role: "user", content: message }]);
      setLiveSteps([]);
      setBusy(true);

      abortRef.current = new AbortController();
      try {
        await streamAgent(
          {
            message,
            conversation_id: conversationIdRef.current,
            project_id: projectId ?? null,
            allow_mutations: allowMutations,
          },
          handleEvent,
          abortRef.current.signal,
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "The assistant is unavailable.");
        }
      } finally {
        setBusy(false);
        setThinking(null);
      }
    },
    [allowMutations, busy, handleEvent, projectId],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return {
    turns,
    busy,
    error,
    allowMutations,
    setAllowMutations,
    liveSteps,
    thinking,
    narration,
    send,
    stop,
  };
}
