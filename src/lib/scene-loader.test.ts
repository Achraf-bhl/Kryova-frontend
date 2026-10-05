import { describe, expect, it } from "vitest";

import { frustumPlanes, lookAt, multiply, perspective } from "./frustum";
import { SceneLoader } from "./scene-loader";
import type { Camera, FetchRequest, ScenePart } from "./scene-streaming";

/**
 * The loop around `scene-streaming`'s arithmetic, driven with promises the test resolves by hand
 * so ordering and overlap are exact rather than a matter of timers.
 */

const CAMERA: Camera = {
  positionMm: [0, 0, 0],
  directionMm: [0, 0, 1],
  viewportPx: 1080,
  fovRad: Math.PI / 3,
};

function part(path: string, z: number, radiusMm = 100, level: number | null = null): ScenePart {
  return { path, centreMm: [0, 0, z], radiusMm, level };
}

interface Pending {
  readonly request: FetchRequest;
  readonly signal: AbortSignal;
  resolve(): void;
  reject(error: Error): void;
}

function harness(parts: ScenePart[], concurrency = 2) {
  const pending: Pending[] = [];
  const loader = new SceneLoader(parts, {
    concurrency,
    fetchPart: (request, signal) =>
      new Promise<void>((resolve, reject) => {
        pending.push({ request, signal, resolve, reject });
      }),
  });
  const settle = () => new Promise((done) => setTimeout(done, 0));
  return { loader, pending, settle };
}

describe("what is fetched first", () => {
  it("is the part that covers the most screen", async () => {
    const { loader, pending } = harness([part("far", 5000), part("near", 500), part("mid", 1500)], 3);
    loader.update(CAMERA);
    expect(pending.map((p) => p.request.path)).toEqual(["near", "mid", "far"]);
  });

  it("is never more at once than the concurrency", () => {
    const { loader, pending } = harness(
      [part("a", 500), part("b", 600), part("c", 700), part("d", 800)],
      2,
    );
    loader.update(CAMERA);
    expect(pending).toHaveLength(2);
    expect(loader.pending).toBe(2);
  });

  it("starts the next one as soon as one lands, chosen against the camera as it then is", async () => {
    const { loader, pending, settle } = harness([part("a", 500), part("b", 600), part("c", 700)], 1);
    loader.update(CAMERA);
    expect(pending.map((p) => p.request.path)).toEqual(["a"]);

    // The camera turns round before "a" lands: nothing is in front of it any more.
    loader.update({ ...CAMERA, directionMm: [0, 0, -1] });
    pending[0].resolve();
    await settle();
    expect(pending).toHaveLength(1);
  });
});

describe("a level only moves toward finer", () => {
  it("is held once a fetch lands", async () => {
    const { loader, pending, settle } = harness([part("a", 500)]);
    loader.update(CAMERA);
    pending[0].resolve();
    await settle();
    expect(loader.levelOf("a")).toBe(pending[0].request.level);
  });

  it("is not replaced by a coarser response that arrives late", async () => {
    const { loader, pending, settle } = harness([part("a", 20000)]);
    loader.update(CAMERA); // far: a coarse level
    const coarse = pending[0];
    expect(coarse.request.level).toBeGreaterThan(0);

    // Hold the coarse one in flight; the part cannot be asked for twice, so land it, then close in.
    coarse.resolve();
    await settle();
    loader.update({ ...CAMERA, positionMm: [0, 0, 19600] });
    const fine = pending[1];
    expect(fine.request.level).toBeLessThan(coarse.request.level);
    fine.resolve();
    await settle();
    expect(loader.levelOf("a")).toBe(fine.request.level);

    // Back away: a coarser level is not even asked for.
    loader.update(CAMERA);
    expect(pending).toHaveLength(2);
  });

  it("is not asked for again when already held", async () => {
    const { loader, pending, settle } = harness([part("a", 500)]);
    loader.update(CAMERA);
    pending[0].resolve();
    await settle();
    loader.update(CAMERA);
    loader.update(CAMERA);
    expect(pending).toHaveLength(1);
  });
});

describe("one request per part at a time", () => {
  it("a wobbling camera does not issue the same fetch every frame", () => {
    const { loader, pending } = harness([part("a", 500)]);
    for (let frame = 0; frame < 10; frame++) {
      loader.update({ ...CAMERA, positionMm: [frame * 0.01, 0, 0] });
    }
    expect(pending).toHaveLength(1);
  });
});

describe("failures", () => {
  it("are listed with the part and the reason, and not retried by themselves", async () => {
    const { loader, pending, settle } = harness([part("a", 500)]);
    loader.update(CAMERA);
    pending[0].reject(new Error("the server said 500"));
    await settle();
    expect(loader.failures).toEqual([
      { path: "a", level: pending[0].request.level, message: "the server said 500" },
    ]);
    loader.update(CAMERA);
    loader.update(CAMERA);
    expect(pending).toHaveLength(1);
  });

  it("are tried again when asked", async () => {
    const { loader, pending, settle } = harness([part("a", 500)]);
    loader.update(CAMERA);
    pending[0].reject(new Error("boom"));
    await settle();
    loader.retryFailed();
    expect(pending).toHaveLength(2);
    expect(loader.failures).toEqual([]);
  });

  it("one part's failure does not stop the others", async () => {
    const { loader, pending, settle } = harness([part("a", 500), part("b", 600)], 1);
    loader.update(CAMERA);
    pending[0].reject(new Error("boom"));
    await settle();
    expect(pending[1].request.path).toBe("b");
  });
});

describe("culling", () => {
  const planes = frustumPlanes(
    multiply(perspective(Math.PI / 3, 1, 10, 100_000), lookAt([0, 0, 0], [0, 0, 1])),
  );

  it("with a frustum, a part beside the view is not fetched though it is in front", () => {
    const aside: ScenePart = { path: "aside", centreMm: [90_000, 0, 1000], radiusMm: 100, level: null };
    const ahead = part("ahead", 1000);
    const { loader, pending } = harness([aside, ahead], 4);
    loader.update(CAMERA, planes);
    expect(pending.map((p) => p.request.path)).toEqual(["ahead"]);
  });

  it("without one, the half-space test is all there is, and the part is fetched", () => {
    const aside: ScenePart = { path: "aside", centreMm: [90_000, 0, 1000], radiusMm: 100, level: null };
    const { loader, pending } = harness([aside], 4);
    loader.update(CAMERA);
    expect(pending.map((p) => p.request.path)).toEqual(["aside"]);
  });
});

describe("disposal", () => {
  it("aborts what is in flight and starts nothing more", async () => {
    const { loader, pending, settle } = harness([part("a", 500), part("b", 600), part("c", 700)], 1);
    loader.update(CAMERA);
    loader.dispose();
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].resolve();
    await settle();
    loader.update(CAMERA);
    expect(pending).toHaveLength(1);
  });

  it("an aborted fetch is not reported as a failure", async () => {
    const { loader, pending, settle } = harness([part("a", 500)]);
    loader.update(CAMERA);
    loader.dispose();
    pending[0].reject(new Error("aborted"));
    await settle();
    expect(loader.failures).toEqual([]);
  });
});
