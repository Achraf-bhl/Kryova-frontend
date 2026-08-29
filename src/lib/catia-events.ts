import { API_BASE_URL } from "@/lib/api-client";
import type { CatiaEvent } from "@/types/catia";

/**
 * Subscribe to the backend's CATIA event relay.
 *
 * `EventSource` rather than a hand-rolled reader: this is a plain GET, and the
 * backend only requires the session cookie on a GET (the CSRF header is checked
 * on mutations only — see `app/api/deps.py`), so the one thing `EventSource`
 * cannot do does not matter here. `withCredentials` is what sends the cookie
 * cross-origin; without it the stream 401s and the browser retries forever.
 *
 * There is deliberately no Next route handler in front of this. The old one
 * proxied `http://localhost:9100`, a service that never existed in this
 * architecture — the daemon dials out to the backend and the browser never
 * reaches it. See `docs/CATIA_BRIDGE_PROTOCOL.md`.
 */

export interface CatiaEventStreamHandlers {
  onEvent: (event: CatiaEvent) => void;
  /** The stream is live (the backend sends a `stream_open` frame immediately). */
  onOpen?: () => void;
  /** Transport failed. The caller owns the retry policy. */
  onError?: () => void;
}

/** Open the stream. Returns a function that closes it. */
export function openCatiaEventStream(handlers: CatiaEventStreamHandlers): () => void {
  if (typeof EventSource === "undefined") return () => {};

  const source = new EventSource(`${API_BASE_URL}/catia/events`, { withCredentials: true });

  source.onopen = () => handlers.onOpen?.();

  source.onmessage = (message: MessageEvent<string>) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as CatiaEvent);
    } catch {
      // One malformed frame must not tear down a working stream.
    }
  };

  source.onerror = () => {
    // EventSource retries on its own for transport blips but gives up on an
    // HTTP error, and it cannot refresh an expired session either way. Hand
    // control back to the caller, which reconnects with backoff after the
    // status poll has had a chance to renew the cookie.
    source.close();
    handlers.onError?.();
  };

  return () => source.close();
}
