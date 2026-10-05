import { describe, expect, it } from "vitest";

import {
  buildCrashReport,
  CONSENT_KEY,
  isAcceptableEndpoint,
  MAX_MESSAGE_CHARS,
  readOffer,
  stopOffering,
  type CrashReportInput,
} from "./crash-report";

function input(overrides: Partial<CrashReportInput> = {}): CrashReportInput {
  return {
    appVersion: "0.2.0",
    platform: "Win32",
    generatedAt: "2026-10-05T10:00:00.000Z",
    route: "/dashboard/projects/p1",
    error: { message: "Failed to fetch", digest: "d123" },
    logs: [{ name: "backend.log", tail: "started\nboom" }],
    ...overrides,
  };
}

describe("what a crash report holds", () => {
  it("names the version, the platform, the place, the error and the logs", () => {
    const report = buildCrashReport(input());

    expect(report).toContain("Version: 0.2.0");
    expect(report).toContain("Platform: Win32");
    expect(report).toContain("Where: /dashboard/projects/p1");
    expect(report).toContain("Failed to fetch");
    expect(report).toContain("Reference: d123");
    expect(report).toContain("--- backend.log\nstarted\nboom");
  });

  it("leaves the conversation out unless the person ticked the box, and says so", () => {
    expect(buildCrashReport(input())).toContain("Conversation: not included.");
  });

  it("includes the messages when, and only when, they are handed in", () => {
    const report = buildCrashReport(
      input({ transcript: [{ role: "user", content: "make a bracket" }] }),
    );

    expect(report).toContain("included at the person's request (1 messages)");
    expect(report).toContain("--- user\nmake a bracket");
  });

  it("has no input at all for an attachment, a file, a geometry or a project", () => {
    // The builder's input type is the whole list of what can be reported. If somebody adds a
    // field for file contents this test names it, and the review has to say why.
    const allowed = ["appVersion", "platform", "generatedAt", "route", "error", "logs", "transcript"];
    const supplied = Object.keys(input({ transcript: [] })).sort();

    expect(supplied).toEqual([...allowed].sort());
  });

  it("drops the query string and the fragment from the route", () => {
    const report = buildCrashReport(input({ route: "/dashboard/c/abc?token=zzz#frag" }));

    expect(report).toContain("Where: /dashboard/c/abc\n");
    expect(report).not.toContain("zzz");
  });

  it("scrubs a credential out of the error, the logs and the messages", () => {
    const report = buildCrashReport(
      input({
        error: { message: "failed postgresql://u:hunter2@h/db", stack: "Authorization: Bearer abcdefgh12345678" },
        logs: [{ name: "backend.log", tail: "api_key=sk-live-abcdefghijklmnopqrstu" }],
        transcript: [{ role: "user", content: "my password=letmein is fine" }],
      }),
    );

    for (const secret of ["hunter2", "abcdefgh12345678", "sk-live-abcdefghijklmnopqrstu", "letmein"]) {
      expect(report).not.toContain(secret);
    }
  });

  it("clips one enormous message and says how much it left out", () => {
    const report = buildCrashReport(
      input({ transcript: [{ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS + 50) }] }),
    );

    expect(report).toContain("[… 50 more characters left out]");
  });

  it("says when no log was available instead of implying the logs were empty", () => {
    expect(buildCrashReport(input({ logs: [] }))).toContain("Logs: none were available.");
  });
});

describe("the one stored preference", () => {
  function fakeStorage(initial: string | null) {
    const state = { value: initial };
    return {
      state,
      getItem: (key: string) => (key === CONSENT_KEY ? state.value : null),
      setItem: (key: string, value: string) => {
        if (key === CONSENT_KEY) state.value = value;
      },
    };
  }

  it("asks by default, and on a stale or unknown value", () => {
    expect(readOffer(fakeStorage(null))).toBe("ask");
    expect(readOffer(fakeStorage("always"))).toBe("ask");
    expect(readOffer(null)).toBe("ask");
  });

  it("stops asking only after the person says so", () => {
    const storage = fakeStorage(null);

    stopOffering(storage);

    expect(readOffer(storage)).toBe("never");
  });

  it("asks again when storage throws, which is the safe direction", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readOffer(broken)).toBe("ask");
    expect(() => stopOffering(broken)).not.toThrow();
  });
});

describe("where a report may go", () => {
  it.each(["https://reports.example.com/in", "http://127.0.0.1:9000/in", "http://localhost/in"])(
    "accepts %s",
    (url) => expect(isAcceptableEndpoint(url)).toBe(true),
  );

  it.each([undefined, "", "not a url", "http://reports.example.com/in", "ftp://x/y", "javascript:alert(1)"])(
    "refuses %s",
    (url) => expect(isAcceptableEndpoint(url)).toBe(false),
  );
});
