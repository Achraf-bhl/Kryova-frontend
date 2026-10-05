/**
 * Frames per second, measured — ROAD_TO_10 6.9 says "measure frames per second rather than
 * guessing", and this is the thing that does the measuring.
 *
 * A viewer calls `tick(now)` once per animation frame and reads `snapshot()` whenever it wants a
 * figure. The *average* frame rate hides what a person feels: ninety smooth frames and ten
 * 200 ms stalls average to a respectable number and look broken, so the snapshot carries the
 * 95th-percentile and worst frame time beside it. No timers, no `performance.now()` inside —
 * the caller passes the time, so every figure is reproducible in a test.
 */

export interface FrameStats {
  /** Frames in the window. */
  readonly frames: number;
  /** Mean frames per second over the window; 0 until two frames have been seen. */
  readonly fps: number;
  /** The frame time, in ms, that 95% of frames came in under. */
  readonly p95FrameMs: number;
  /** The longest single frame in the window, in ms. */
  readonly worstFrameMs: number;
}

export class FrameMeter {
  private readonly deltas: number[] = [];
  private last: number | null = null;

  /** `windowFrames` is how many recent frames a snapshot describes. */
  constructor(private readonly windowFrames = 120) {
    if (!Number.isInteger(windowFrames) || windowFrames < 2) {
      throw new Error("A frame meter needs a window of at least two frames.");
    }
  }

  /** Record that a frame was presented at `nowMs` (any monotonic clock, in milliseconds). */
  tick(nowMs: number): void {
    if (this.last !== null) {
      // A clock that went backwards is dropped, not recorded as a negative frame.
      if (nowMs > this.last) this.deltas.push(nowMs - this.last);
      while (this.deltas.length > this.windowFrames) this.deltas.shift();
    }
    this.last = nowMs;
  }

  reset(): void {
    this.deltas.length = 0;
    this.last = null;
  }

  snapshot(): FrameStats {
    const count = this.deltas.length;
    if (count === 0) return { frames: 0, fps: 0, p95FrameMs: 0, worstFrameMs: 0 };
    const total = this.deltas.reduce((sum, delta) => sum + delta, 0);
    const sorted = [...this.deltas].sort((a, b) => a - b);
    const p95 = sorted[Math.min(count - 1, Math.ceil(count * 0.95) - 1)];
    return {
      frames: count,
      fps: 1000 / (total / count),
      p95FrameMs: p95,
      worstFrameMs: sorted[count - 1],
    };
  }
}
