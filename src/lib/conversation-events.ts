/**
 * A one-line pub/sub so the sidebar can refresh itself after a turn.
 *
 * The alternative was `router.refresh()`, which re-renders the route's Server
 * Components — and the chat view is a client component whose whole job is to
 * hold a live SSE stream. Nudging the router mid-stream to update a list in the
 * sidebar risks the one thing this rebuild exists to fix: losing a conversation
 * that is halfway through happening.
 */

const EVENT_NAME = "kryova:conversations-changed";

/** Tell any mounted sidebar that the conversation list is stale. */
export function notifyConversationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

/** Subscribe. Returns an unsubscribe function. */
export function onConversationsChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
