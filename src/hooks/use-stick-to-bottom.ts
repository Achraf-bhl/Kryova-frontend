"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keep a scroll container pinned to the newest content — unless the reader has
 * deliberately scrolled away from it.
 *
 * The chat used to scroll to the bottom on every streamed event, unconditionally.
 * During a long turn that fires on every `thinking`, `narration`, `tool_start`
 * and `tool_end`, which means a user who scrolls up to re-read what the agent
 * said thirty seconds ago is dragged back down within a second, repeatedly, for
 * as long as the agent is working. The content they were reading is still there;
 * they simply cannot look at it. That is the continuity problem this fixes:
 * a conversation you cannot read back is not a conversation you can follow.
 *
 * The rule is the one every chat client converges on: **auto-scroll only while
 * the reader is already at the bottom.** Scrolling up is treated as intent and
 * suspends the behaviour; returning to the bottom resumes it. Nothing is ever
 * scrolled out from under a reader who is looking at it.
 *
 * `THRESHOLD_PX` is what makes "at the bottom" survive contact with reality —
 * fractional device pixels, a growing composer, and a container whose height
 * changes mid-stream all mean `scrollTop + clientHeight` is rarely exactly
 * `scrollHeight`. An exact comparison unpins on the first render and never
 * re-pins.
 */
const THRESHOLD_PX = 64;

export interface StickToBottom {
  /**
   * Attach to the scrolling element.
   *
   * A callback ref rather than a `RefObject`, and that is not a style choice.
   * Assigning `ref.current` does not re-run effects, so an effect that binds the
   * scroll listener with stable dependencies binds it once — against whatever
   * the ref held at mount, which is `null` whenever the element appears later
   * or is replaced. The listener then never attaches, `pinned` never leaves its
   * initial `true`, and the hook silently degrades to the unconditional
   * auto-scroll it exists to replace. A callback ref makes the node a state
   * transition, so the listener binds when the element actually arrives.
   */
  ref: (element: HTMLDivElement | null) => void;
  /** False when the reader has scrolled up and new content is arriving below. */
  pinned: boolean;
  /** Re-pin and jump to the newest content. */
  scrollToBottom: () => void;
}

/** Whether the element is scrolled close enough to the bottom to count as at it. */
export function isAtBottom(element: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= THRESHOLD_PX;
}

/**
 * @param dependencies Values that mean "new content arrived". The hook scrolls
 *   when these change and the view is pinned.
 */
export function useStickToBottom(dependencies: readonly unknown[]): StickToBottom {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  // Identity-stable, so passing it as a JSX ref does not detach and re-attach
  // the element on every render.
  const ref = useCallback((element: HTMLDivElement | null) => setNode(element), []);

  /**
   * A mirror of `pinned` readable synchronously.
   *
   * The content effect below must not re-run when pinning changes — re-running
   * it on unpin would scroll to the bottom at the exact moment the reader
   * scrolled away, which is the bug inverted. So it reads the ref and lists
   * only the content dependencies.
   */
  const pinnedRef = useRef(true);
  const setPinnedBoth = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setPinned(next);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!node) return;
    setPinnedBoth(true);
    scrollToEnd(node);
  }, [node, setPinnedBoth]);

  // Track where the reader is. Passive: this listener never calls
  // `preventDefault`, and saying so lets the browser scroll without waiting
  // for it.
  useEffect(() => {
    if (!node) return;
    const onScroll = () => setPinnedBoth(isAtBottom(node));
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [node, setPinnedBoth]);

  // The dependency list is the caller's content signals, forwarded verbatim.
  // The lint rule cannot statically verify a list it did not see written out,
  // which is inherent to a hook that takes its triggers as an argument.
  // `pinned` is deliberately absent: it is read through `pinnedRef`, because
  // re-running this on unpin would scroll to the bottom at the exact moment the
  // reader scrolled away.
  useEffect(() => {
    if (!node || !pinnedRef.current) return;
    scrollToEnd(node);
    // The dependency list is the caller's content signals, forwarded verbatim,
    // plus the node. The rule cannot verify a list it did not see written out,
    // which is inherent to a hook that takes its triggers as an argument.
    // `pinned` is deliberately absent: it is read through `pinnedRef`, because
    // re-running this on unpin would scroll to the bottom at the exact moment
    // the reader scrolled away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, ...dependencies]);

  return { ref, pinned, scrollToBottom };
}

/**
 * `scrollTo` is missing in jsdom and in some embedded webviews; assigning
 * `scrollTop` is the universally available equivalent, minus the easing.
 */
function scrollToEnd(element: HTMLDivElement): void {
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  } else {
    element.scrollTop = element.scrollHeight;
  }
}
