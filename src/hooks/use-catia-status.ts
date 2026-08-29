"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api-client";
import { openCatiaEventStream } from "@/lib/catia-events";
import type { CatiaConnectionState, CatiaEvent, CatiaStatus } from "@/types/catia";

/**
 * Live CATIA bridge state for the signed-in user.
 *
 * Two channels, because they answer different questions. The poll answers "is a
 * workstation connected right now, and which CATIA" — it also refreshes an
 * expiring session on the way, which is why it keeps running even while the
 * stream is healthy (`EventSource` cannot retry a 401 by itself). The stream
 * answers "what just happened in CATIA", and pokes the poll when an event
 * implies the answer changed.
 *
 * This is the lazy/interactive exception to "no initial fetch in `useEffect`":
 * it is a live device status, not page data, and no server render could be
 * right about it for longer than a few seconds.
 */

const POLL_CONNECTED_MS = 20_000;
const POLL_DISCONNECTED_MS = 8_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;
const MAX_EVENTS = 50;

/** Events that change the answer to "is CATIA connected / what is bound". */
const STATUS_CHANGING = new Set([
  "bridge_connected",
  "catia_lost",
  "document_opened",
  "document_saved",
  "checkpoint_created",
]);

export interface CatiaBridge {
  state: CatiaConnectionState;
  status: CatiaStatus | null;
  /** One sentence a user can act on. Never "something went wrong". */
  detail: string;
  events: CatiaEvent[];
  lastEvent: CatiaEvent | null;
  refresh: () => void;
}

function describe(status: CatiaStatus | null, error: string | null): string {
  if (error) return error;
  if (!status) return "Checking whether a CATIA workstation is connected…";
  if (!status.enabled) {
    return "CATIA integration is switched off on this server.";
  }
  if (status.connected) {
    const version = status.catia_version || "CATIA";
    return status.mock
      ? `${status.device_name} is connected in mock mode — no real CATIA session.`
      : `${status.device_name} is connected, running ${version}.`;
  }
  return status.detail;
}

function stateOf(status: CatiaStatus | null, error: string | null): CatiaConnectionState {
  if (error) return "unavailable";
  if (!status) return "connecting";
  if (!status.enabled) return "unavailable";
  return status.connected ? "connected" : "offline";
}

export function useCatiaStatus(conversationId?: string | null): CatiaBridge {
  const [status, setStatus] = useState<CatiaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CatiaEvent[]>([]);

  const mountedRef = useRef(true);
  const conversationRef = useRef<string | null>(conversationId ?? null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.catiaStatus(conversationRef.current);
      if (!mountedRef.current) return;
      setStatus(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      // A 404 means this server has no CATIA bridge at all, which is a real
      // deployment and not a fault; anything else is worth showing verbatim.
      setError(
        err instanceof ApiError && err.status === 404
          ? "This Kryova server has no CATIA bridge configured."
          : err instanceof Error
            ? err.message
            : "Could not reach Kryova to ask about CATIA.",
      );
    }
  }, []);

  // Load now, and again whenever the conversation changes: the bound document
  // is per-conversation, so the same status call answers a different question.
  useEffect(() => {
    conversationRef.current = conversationId ?? null;
    void load();
  }, [conversationId, load]);

  // Poll. The interval tightens while nothing is connected, because that is
  // exactly when the user is standing at the other machine waiting for the dot
  // to turn green.
  const connected = status?.connected ?? false;
  useEffect(() => {
    const interval = window.setInterval(
      () => void load(),
      connected ? POLL_CONNECTED_MS : POLL_DISCONNECTED_MS,
    );
    return () => window.clearInterval(interval);
  }, [connected, load]);

  // Stream, with our own backoff.
  useEffect(() => {
    let closeStream: (() => void) | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;
    let cancelled = false;

    const open = (): void => {
      if (cancelled) return;
      closeStream = openCatiaEventStream({
        onOpen: () => {
          attempt = 0;
        },
        onEvent: (event) => {
          if (cancelled) return;
          if (event.event === "stream_open") return;
          setEvents((previous) => [event, ...previous].slice(0, MAX_EVENTS));
          if (STATUS_CHANGING.has(event.event)) void load();
        },
        onError: () => {
          if (cancelled) return;
          // The original bug here was a reconnect that only fired when an
          // EventSource already existed in CLOSED state — so the one path that
          // always happens first, a stream that never opened at all, never
          // retried. Retry unconditionally, with a ceiling.
          closeStream = null;
          const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
          attempt += 1;
          retryTimer = window.setTimeout(open, delay);
        },
      });
    };

    open();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      closeStream?.();
    };
  }, [load]);

  return {
    state: stateOf(status, error),
    status,
    detail: describe(status, error),
    events,
    lastEvent: events[0] ?? null,
    refresh: () => void load(),
  };
}
