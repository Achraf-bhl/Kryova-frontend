/**
 * Loading a scene's parts progressively, most useful first — ROAD_TO_10 6.9.
 *
 * `scene-streaming.ts` answers *what* to fetch next as arithmetic and is deliberately free of
 * `fetch`. This is the loop that drives it: it holds each part's level, asks `plan` what the
 * camera now wants, starts that many fetches at a time, and re-plans as each one lands so the
 * next request is chosen against where the camera is *then* and not where it was when the
 * queue was built. The caller supplies `fetchPart` (a GLB request and an upload to the GPU) and
 * the camera; nothing here touches a network or a GL context, so the scheduling is testable.
 *
 * Four rules, each pinned by a test:
 * 1. **A level is a high-water mark and only moves toward finer.** A slow coarse response that
 *    arrives after a finer one must not replace it.
 * 2. **Never two requests for one part at once, and never one for a level already held or
 *    already in flight.** A camera that wobbles must not issue the same fetch every frame.
 * 3. **A failure is not retried by itself.** The same request would fail the same way every
 *    frame; `retryFailed` is the explicit way back, and the failures are listed so a viewer can
 *    say which parts it could not load rather than draw a machine with holes in it silently.
 * 4. **Culling uses the full frustum when the caller has one**, and the half-space test
 *    `plan` already applies when it does not.
 */

import { sphereInFrustum, type Plane } from "./frustum";
import { plan, type Camera, type FetchRequest, type ScenePart } from "./scene-streaming";

export interface LoaderOptions {
  /** Load one part at one level. Rejects if it cannot. Must stop early when `signal` aborts. */
  readonly fetchPart: (request: FetchRequest, signal: AbortSignal) => Promise<void>;
  /** Requests in flight at once. A browser allows about six connections to one host. */
  readonly concurrency?: number;
}

export interface LoadFailure {
  readonly path: string;
  readonly level: number;
  readonly message: string;
}

export class SceneLoader {
  private readonly levels = new Map<string, number | null>();
  private readonly inFlight = new Map<string, number>();
  private readonly failed = new Map<string, LoadFailure>();
  private readonly controller = new AbortController();
  private lastCamera: Camera | null = null;
  private lastPlanes: readonly Plane[] | null = null;
  private disposed = false;

  constructor(
    private readonly parts: readonly ScenePart[],
    private readonly options: LoaderOptions,
  ) {
    for (const part of parts) this.levels.set(part.path, part.level);
  }

  /** The level each part is held at, `null` for a box only. */
  levelOf(path: string): number | null {
    return this.levels.get(path) ?? null;
  }

  get pending(): number {
    return this.inFlight.size;
  }

  get failures(): LoadFailure[] {
    return [...this.failed.values()];
  }

  /** The camera moved: choose what to fetch against it and start as many as there is room for. */
  update(camera: Camera, planes?: readonly Plane[]): void {
    this.lastCamera = camera;
    this.lastPlanes = planes ?? null;
    this.pump();
  }

  /** Forget every failure so the next `update` asks for those parts again. */
  retryFailed(): void {
    this.failed.clear();
    this.pump();
  }

  /** Stop everything in flight and start nothing more. */
  dispose(): void {
    this.disposed = true;
    this.controller.abort();
  }

  private get concurrency(): number {
    return Math.max(1, this.options.concurrency ?? 6);
  }

  private pump(): void {
    if (this.disposed || this.lastCamera === null) return;
    const room = this.concurrency - this.inFlight.size;
    if (room <= 0) return;

    const current: ScenePart[] = this.parts
      .filter((part) => this.lastPlanes === null || sphereInFrustum(this.lastPlanes, part.centreMm, part.radiusMm))
      .map((part) => ({ ...part, level: this.levels.get(part.path) ?? null }));

    // Ask for more than there is room for: some of the best N are in flight or failed already.
    const wanted = plan(current, this.lastCamera, this.parts.length);
    let started = 0;
    for (const request of wanted) {
      if (started >= room) break;
      if (this.inFlight.has(request.path)) continue;
      if (this.failed.has(`${request.path}@${request.level}`)) continue;
      this.start(request);
      started++;
    }
  }

  private start(request: FetchRequest): void {
    this.inFlight.set(request.path, request.level);
    this.options
      .fetchPart(request, this.controller.signal)
      .then(() => {
        const held = this.levels.get(request.path) ?? null;
        // Rule 1: only ever finer.
        if (held === null || request.level < held) this.levels.set(request.path, request.level);
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        this.failed.set(`${request.path}@${request.level}`, {
          path: request.path,
          level: request.level,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.inFlight.delete(request.path);
        this.pump();
      });
  }
}
