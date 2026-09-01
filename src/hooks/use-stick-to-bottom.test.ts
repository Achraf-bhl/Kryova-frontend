import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { isAtBottom, useStickToBottom } from "@/hooks/use-stick-to-bottom";

/**
 * jsdom gives every element a zero layout, so a scroll container has to be
 * faked. These are the three numbers the hook reads, made writable so a test can
 * put the reader anywhere in the transcript.
 */
function attach(
  element: HTMLDivElement,
  { scrollTop, clientHeight, scrollHeight }: Record<string, number>,
) {
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  let top = scrollTop;
  Object.defineProperty(element, "scrollTop", {
    get: () => top,
    set: (next: number) => {
      top = next;
    },
    configurable: true,
  });
  return element;
}

describe("isAtBottom", () => {
  it("is true when the container is scrolled to the end", () => {
    expect(isAtBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
  });

  it("tolerates the sub-pixel gap a real browser leaves", () => {
    // The exact-equality version of this check unpinned on the first render and
    // never re-pinned, because scrollTop is fractional on a HiDPI display.
    expect(isAtBottom({ scrollTop: 899.6, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
  });

  it("is false once the reader has scrolled meaningfully away", () => {
    expect(isAtBottom({ scrollTop: 400, clientHeight: 100, scrollHeight: 1000 })).toBe(false);
  });

  it("is true for content shorter than the viewport", () => {
    // Nothing to scroll: a short conversation must count as pinned, or the
    // "jump to latest" button would show with nowhere to jump to.
    expect(isAtBottom({ scrollTop: 0, clientHeight: 600, scrollHeight: 400 })).toBe(true);
  });
});

describe("useStickToBottom", () => {
  it("starts pinned and follows new content", () => {
    const { result, rerender } = renderHook(({ deps }) => useStickToBottom(deps), {
      initialProps: { deps: [1] as unknown[] },
    });

    const element = attach(document.createElement("div"), {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
    });
    act(() => result.current.ref(element));

    expect(result.current.pinned).toBe(true);
    rerender({ deps: [2] });
    expect(element.scrollTop).toBe(1000);
  });

  it("stops following once the reader scrolls up, and does not yank them back", () => {
    const { result, rerender } = renderHook(({ deps }) => useStickToBottom(deps), {
      initialProps: { deps: [1] as unknown[] },
    });

    const element = attach(document.createElement("div"), {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
    });
    act(() => result.current.ref(element));

    act(() => {
      element.scrollTop = 200;
      element.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.pinned).toBe(false);

    // This is the regression: a streaming turn fires many of these, and each
    // one used to drag the reader back down.
    rerender({ deps: [2] });
    rerender({ deps: [3] });
    expect(element.scrollTop).toBe(200);
  });

  it("re-pins and jumps when asked", () => {
    const { result, rerender } = renderHook(({ deps }) => useStickToBottom(deps), {
      initialProps: { deps: [1] as unknown[] },
    });

    const element = attach(document.createElement("div"), {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
    });
    act(() => result.current.ref(element));
    act(() => {
      element.scrollTop = 100;
      element.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.pinned).toBe(false);

    act(() => result.current.scrollToBottom());
    expect(result.current.pinned).toBe(true);
    expect(element.scrollTop).toBe(1000);

    // And having re-pinned, it follows again.
    Object.defineProperty(element, "scrollHeight", { value: 1400, configurable: true });
    rerender({ deps: [2] });
    expect(element.scrollTop).toBe(1400);
  });

  it("survives a container that has no scrollTo", () => {
    // jsdom and some embedded webviews have no Element.scrollTo. The hook must
    // fall back to assigning scrollTop rather than throwing mid-stream.
    const { result, rerender } = renderHook(({ deps }) => useStickToBottom(deps), {
      initialProps: { deps: [1] as unknown[] },
    });
    const element = attach(document.createElement("div"), {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 800,
    });
    expect(typeof element.scrollTo).not.toBe("function");
    act(() => result.current.ref(element));

    expect(() => rerender({ deps: [2] })).not.toThrow();
    expect(element.scrollTop).toBe(800);
  });
});
