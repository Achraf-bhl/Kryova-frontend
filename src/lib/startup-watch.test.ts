import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DIAGNOSTICS_AFTER_MS,
  POLL_MS,
  STARTING_QUERY,
  isStartingQuery,
  startingMessage,
} from "./startup-watch";

/** The wording and timing of the "still starting" page (ROAD_TO_10 4.3). */
describe("the starting query", () => {
  it("is exactly what the shell opens the window on", () => {
    // `STARTING_PAGE` in src-tauri/src/layout.rs. Two spellings of one URL is a first launch
    // that shows the old "API not reachable" page instead of waiting.
    const layout = readFileSync(join(process.cwd(), "src-tauri/src/layout.rs"), "utf8");
    expect(layout).toContain(`pub const STARTING_PAGE: &str = "/setup?${STARTING_QUERY}";`);
  });

  it("is recognised on the query alone", () => {
    expect(isStartingQuery("?starting=1")).toBe(true);
    expect(isStartingQuery("?other=1&starting=1")).toBe(true);
    expect(isStartingQuery("")).toBe(false);
    expect(isStartingQuery("?starting=0")).toBe(false);
    expect(isStartingQuery("?starting")).toBe(false);
  });
});

describe("what it says while waiting", () => {
  it("starts calm and short", () => {
    const message = startingMessage(0);

    expect(message.headline).toBe("Starting Kryova…");
    expect(message.showDiagnostics).toBe(false);
  });

  it("explains the first launch once it is taking longer than a normal start", () => {
    const message = startingMessage(30_000);

    expect(message.headline).toBe("Still starting…");
    expect(message.detail).toMatch(/creates Kryova's database/);
    expect(message.showDiagnostics).toBe(false);
  });

  it("offers the diagnostics only once a normal start is long over", () => {
    expect(startingMessage(DIAGNOSTICS_AFTER_MS - 1).showDiagnostics).toBe(false);
    expect(startingMessage(DIAGNOSTICS_AFTER_MS).showDiagnostics).toBe(true);
  });

  it("never claims progress it cannot see, and never says it failed", () => {
    for (const elapsed of [0, 25_000, 120_000, 900_000]) {
      const { headline, detail } = startingMessage(elapsed);
      const text = `${headline} ${detail}`;
      expect(text).not.toMatch(/\d+\s?%/);
      expect(text).not.toMatch(/fail|error|broken/i);
    }
  });

  it("polls often enough to feel prompt and not so often it is a flood", () => {
    expect(POLL_MS).toBeGreaterThanOrEqual(1_000);
    expect(POLL_MS).toBeLessThanOrEqual(5_000);
  });
});
