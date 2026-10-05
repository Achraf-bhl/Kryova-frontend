import { describe, expect, it } from "vitest";

import type { AIStatus } from "@/types/api";
import type { CatiaStatus } from "@/types/catia";

import { FIRST_PROMPT, firstPrompt, healthUrl, interpretHealth, interpretMachine } from "./machine-checks";

const ai: AIStatus = { enabled: true, provider: "deepseek", model: "deepseek-flash", detail: null };
const offline = (paired: number): CatiaStatus => ({
  connected: false,
  enabled: true,
  backend: "catia",
  paired_devices: paired,
  document: null,
  detail: paired ? "Paired but offline." : "Nothing is paired.",
});
const online = (mock: boolean): CatiaStatus => ({
  connected: true,
  enabled: true,
  backend: "catia",
  paired_devices: 1,
  document: null,
  device_id: "d",
  device_name: "Seat 1",
  hostname: "h",
  catia_version: "V5-R33",
  bridge_version: "1",
  mock,
  capabilities: [],
  ui_language: "fr",
  queue_depth: 0,
  connected_since: "2026-10-05T00:00:00Z",
});
const kernel = {
  connected: true,
  enabled: true,
  backend: "occt",
  backend_version: "7.8",
  paired_devices: 0,
  operations_implemented: null,
  operations_declared: null,
  open_documents: 0,
  document: null,
  detail: "",
} as CatiaStatus;

describe("interpretHealth", () => {
  it("ticks what the server says is ok and names what it says is not", () => {
    const rows = interpretHealth({ checks: { database: "ok", media_store: "disk full" } });
    expect(rows[0]).toMatchObject({ id: "database", state: "ok" });
    expect(rows[1]).toMatchObject({ id: "media_store", state: "problem", detail: "disk full" });
    expect(rows[1].fix).toBeTruthy();
  });

  it("calls an unreported check unknown rather than a problem", () => {
    expect(interpretHealth(null).every((row) => row.state === "unknown")).toBe(true);
  });
});

describe("interpretMachine", () => {
  it("says configured, never valid, for a model that has not been tried", () => {
    const [model] = interpretMachine({ ai, catia: kernel });
    expect(model.state).toBe("ok");
    expect(model.detail).toContain("configured");
    expect(model.detail).not.toMatch(/\bvalid\b/);
  });

  it("explains an unconfigured model with the server's own words and a fix", () => {
    const [model] = interpretMachine({ ai: { ...ai, enabled: false, detail: "AI_API_KEY is empty" }, catia: kernel });
    expect(model).toMatchObject({ state: "problem", detail: "AI_API_KEY is empty" });
    expect(model.fix).toContain("AI_API_KEY");
  });

  it("treats an unreadable status as unknown, not as a fault", () => {
    const rows = interpretMachine({ ai: null, catia: null });
    expect(rows.map((r) => r.state)).toEqual(["unknown", "unknown"]);
  });

  it("separates nothing paired, paired but offline, simulator and a real seat", () => {
    const state = (catia: CatiaStatus) => interpretMachine({ ai, catia })[1];
    expect(state(offline(0))).toMatchObject({ state: "problem", detail: "Nothing is paired." });
    expect(state(offline(1)).fix).toContain("offline");
    expect(state(online(true)).state).toBe("note");
    expect(state(online(false))).toMatchObject({ state: "ok" });
    expect(state(online(false)).detail).toContain("V5-R33");
  });

  it("reports the open kernel without pretending there is a seat", () => {
    const row = interpretMachine({ ai, catia: kernel })[1];
    expect(row).toMatchObject({ id: "geometry", state: "ok" });
    expect(row.detail).toContain("no CATIA seat");
  });
});

describe("firstPrompt", () => {
  it("is offered only when a model and somewhere to build are both there", () => {
    expect(firstPrompt(interpretMachine({ ai, catia: kernel }))).toBe(FIRST_PROMPT);
    expect(firstPrompt(interpretMachine({ ai, catia: online(true) }))).toBe(FIRST_PROMPT);
    expect(firstPrompt(interpretMachine({ ai, catia: offline(1) }))).toBeNull();
    expect(firstPrompt(interpretMachine({ ai: { ...ai, enabled: false, detail: null }, catia: kernel }))).toBeNull();
    expect(firstPrompt(interpretMachine({ ai: null, catia: kernel }))).toBeNull();
  });
});

describe("healthUrl", () => {
  it("hangs /health off the API origin, not its /api/v1 prefix", () => {
    expect(healthUrl("http://127.0.0.1:8000/api/v1")).toBe("http://127.0.0.1:8000/health");
    expect(healthUrl("https://api.example.test/api/v1/")).toBe("https://api.example.test/health");
  });
});
