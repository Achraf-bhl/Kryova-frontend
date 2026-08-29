/**
 * Contract tests: this file is the only thing standing between `types/api.ts`
 * and silent drift from the backend.
 *
 * `types/api.ts` is hand-maintained against the backend's Pydantic schemas, and
 * nothing generates or verifies it — so when a backend enum changes, `tsc`
 * stays green and the app breaks at runtime. That is not hypothetical: the job
 * statuses were uppercase here while the API emitted lowercase, so
 * `status === "SUCCEEDED"` was never true, the surface field was never fetched,
 * and the WebGL stress viewer — the product's core deliverable — never
 * rendered. 180 tests passed throughout, because every fixture was written
 * against this file rather than against the server.
 *
 * The assertions below are deliberately written as *literal* strings copied
 * from `app/models/simulation.py`, not derived from the type. A test that reads
 * the value out of the thing it is testing can only ever agree with itself.
 *
 * The real fix is generating this client from the OpenAPI document FastAPI
 * already serves. Until that exists, this is the tripwire.
 */

import { describe, expect, it } from "vitest";

import {
  isTerminalStatus,
  jobStatusLabel,
  TERMINAL_JOB_STATUSES,
  type JobStatus,
} from "@/types/api";

/**
 * Verbatim from `app/models/simulation.py`:
 *
 *   class JobStatus(str, enum.Enum):
 *       QUEUED = "queued"
 *       RUNNING = "running"
 *       SUCCEEDED = "succeeded"
 *       FAILED = "failed"
 *
 * Pydantic serialises a str-enum by value, so these are the strings that
 * actually arrive over the wire.
 */
const BACKEND_JOB_STATUS_VALUES = ["queued", "running", "succeeded", "failed"] as const;

describe("JobStatus matches the backend enum", () => {
  it("accepts every value the API can send", () => {
    // Compile-time: each backend string must be assignable to JobStatus.
    // Runtime: each must round-trip through the helpers without falling through.
    for (const value of BACKEND_JOB_STATUS_VALUES) {
      const status: JobStatus = value;
      expect(jobStatusLabel(status)).not.toBe(status.toUpperCase());
      expect(typeof jobStatusLabel(status)).toBe("string");
    }
  });

  it("treats exactly succeeded and failed as terminal", () => {
    expect([...TERMINAL_JOB_STATUSES].sort()).toEqual(["failed", "succeeded"]);
    expect(isTerminalStatus("succeeded")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("does not silently accept the uppercase spelling that shipped broken", () => {
    // The regression itself. If someone reintroduces uppercase comparisons,
    // these stop being false and the viewer breaks again.
    expect(isTerminalStatus("SUCCEEDED")).toBe(false);
    expect(isTerminalStatus("FAILED")).toBe(false);
  });

  it("labels a running job without duplicating the raw enum", () => {
    // The results page renders `jobStatusLabel(status)` plus an ellipsis. It
    // used to chain three sibling expressions in one <span>, which rendered
    // "Queued…QUEUED" the moment the casing was corrected.
    expect(jobStatusLabel("queued")).toBe("Queued");
    expect(jobStatusLabel("running")).toBe("Solving");
    expect(jobStatusLabel("succeeded")).toBe("Succeeded");
    expect(jobStatusLabel("failed")).toBe("Failed");
  });

  it("passes an unrecognised status straight through rather than throwing", () => {
    // Forward compatibility: a new backend status should degrade to showing
    // its raw value, not crash the results page.
    expect(jobStatusLabel("cancelled")).toBe("cancelled");
    expect(isTerminalStatus("cancelled")).toBe(false);
  });
});
