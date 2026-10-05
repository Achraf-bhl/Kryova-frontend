import { describe, expect, it } from "vitest";

import { FrameMeter } from "./frame-meter";

function run(meter: FrameMeter, deltas: number[], start = 1000): void {
  let now = start;
  meter.tick(now);
  for (const delta of deltas) {
    now += delta;
    meter.tick(now);
  }
}

describe("the frame meter", () => {
  it("reads sixty frames a second from sixteen and two thirds milliseconds", () => {
    const meter = new FrameMeter();
    run(meter, new Array<number>(60).fill(1000 / 60));
    const stats = meter.snapshot();
    expect(stats.frames).toBe(60);
    expect(stats.fps).toBeCloseTo(60, 6);
    expect(stats.worstFrameMs).toBeCloseTo(1000 / 60, 9);
  });

  it("is empty before two frames have been seen", () => {
    const meter = new FrameMeter();
    expect(meter.snapshot()).toEqual({ frames: 0, fps: 0, p95FrameMs: 0, worstFrameMs: 0 });
    meter.tick(5);
    expect(meter.snapshot().frames).toBe(0);
  });

  it("shows the stalls an average hides", () => {
    // Ninety fast frames and ten stalls of 200 ms: the mean looks tolerable, the tail does not.
    const meter = new FrameMeter(100);
    run(meter, [...new Array<number>(90).fill(10), ...new Array<number>(10).fill(200)]);
    const stats = meter.snapshot();
    expect(stats.fps).toBeCloseTo(1000 / 29, 6);
    expect(stats.p95FrameMs).toBe(200);
    expect(stats.worstFrameMs).toBe(200);
  });

  it("describes only the most recent window", () => {
    const meter = new FrameMeter(10);
    run(meter, [...new Array<number>(50).fill(100), ...new Array<number>(10).fill(10)]);
    const stats = meter.snapshot();
    expect(stats.frames).toBe(10);
    expect(stats.fps).toBeCloseTo(100, 6);
    expect(stats.worstFrameMs).toBe(10);
  });

  it("drops a clock that stood still or went backwards instead of recording a negative frame", () => {
    const meter = new FrameMeter();
    meter.tick(100);
    meter.tick(100);
    meter.tick(50);
    meter.tick(66);
    expect(meter.snapshot().frames).toBe(1);
    expect(meter.snapshot().worstFrameMs).toBe(16);
  });

  it("can be reset, so a figure is about one scene and not the one before it", () => {
    const meter = new FrameMeter();
    run(meter, [16, 16, 16]);
    meter.reset();
    expect(meter.snapshot().frames).toBe(0);
    run(meter, [20]);
    expect(meter.snapshot().frames).toBe(1);
  });

  it("refuses a window too small to measure anything", () => {
    expect(() => new FrameMeter(1)).toThrow(/at least two/);
    expect(() => new FrameMeter(2.5)).toThrow(/at least two/);
  });
});
