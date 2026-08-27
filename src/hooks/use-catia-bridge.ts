"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchCatiaStatus } from "@/lib/catia-bridge";
import type { CatiaEvent, CatiaStatus } from "@/types/catia";

const POLL_INTERVAL_MS = 5_000;

export function useCatiaBridge() {
  const [status, setStatus] = useState<CatiaStatus>({ state: "disconnected" });
  const [events, setEvents] = useState<CatiaEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<CatiaEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    // Wrap the state update in a microtask so it doesn't fire synchronously
    // inside the effect body (React strict mode / lint rule compliance).
    Promise.resolve().then(() => {
      setStatus((prev) => ({ ...prev, state: "connecting", error_message: undefined }));
    });

    fetchCatiaStatus()
      .then((data) => {
        if (!mountedRef.current) return;
        setStatus(data);

        const source = new EventSource("/api/catia/events");
        eventSourceRef.current = source;

        source.onmessage = (message) => {
          if (!mountedRef.current) return;
          try {
            const event = JSON.parse(message.data) as CatiaEvent;
            setLastEvent(event);
            setEvents((prev) => [event, ...prev].slice(0, 50));
            setStatus((prev) => ({
              ...prev,
              state: "connected",
              document: event.document_name,
              last_event_at: event.timestamp,
            }));
          } catch {
            // Malformed frame — ignore, keep connection alive.
          }
        };

        source.onerror = () => {
          if (!mountedRef.current) return;
          setStatus((prev) => ({
            ...prev,
            state: "error",
            error_message: "Lost connection to CATIA bridge.",
          }));
        };
      })
      .catch((err: Error) => {
        if (!mountedRef.current) return;
        setStatus({
          state: "error",
          error_message: err.message || "CATIA is not running or the bridge is offline.",
        });
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    const interval = setInterval(() => {
      if (eventSourceRef.current?.readyState === EventSource.CLOSED) {
        connect();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStatus({ state: "disconnected" });
  }, []);

  return { status, events, lastEvent, connect, disconnect };
}
