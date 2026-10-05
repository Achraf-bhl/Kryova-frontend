import { describe, expect, it } from "vitest";

import { translate } from "./i18n/catalogue";
import { APPROVALS_HREF, explainStop } from "./stop-reason";

const bare = { hasIntervention: false, hasNextAction: false };

describe("explainStop", () => {
  it("gives each of the four endings its own sentence", () => {
    const sentences = (["step_budget", "repeated_calls", "needs_input", "awaiting_approval"] as const).map(
      (reason) => explainStop(reason, { hasIntervention: false, hasNextAction: reason === "step_budget" }).text,
    );
    expect(new Set(sentences).size).toBe(4);
  });

  it("does not paint a user's stop, a checkpoint or the provider's queue amber", () => {
    for (const reason of ["cancelled", "awaiting_approval", "task_boundary", "provider_busy"]) {
      expect(explainStop(reason, bare).tone).toBe("muted");
    }
  });

  it("keeps repeated refusals, questions and an exhausted budget amber", () => {
    for (const reason of ["repeated_calls", "needs_input", "step_budget"]) {
      expect(explainStop(reason, bare).tone).toBe("warning");
    }
  });

  it("sends a checkpoint to the Approvals page, the one remedy that is a place", () => {
    expect(explainStop("awaiting_approval", bare).link).toEqual({
      href: APPROVALS_HREF,
      label: "Open Approvals",
    });
    expect(explainStop("repeated_calls", bare).link).toBeUndefined();
  });

  it("points at the prompt below only when there is one", () => {
    expect(explainStop("needs_input", { ...bare, hasIntervention: true }).text).toContain("Answer below");
    expect(explainStop("needs_input", bare).text).toContain("end of its answer");
  });

  it("promises a Continue button only when the server sent one", () => {
    expect(explainStop("step_budget", { ...bare, hasNextAction: true }).text).toContain("press Continue");
    expect(explainStop("step_budget", bare).text).not.toContain("Continue");
    expect(explainStop(undefined, bare).text).toContain("Ask for one thing at a time");
  });
});

describe("explainStop in French", () => {
  const fr = (key: Parameters<typeof translate>[1]) => translate("fr", key);

  it("says the same thing in the user's language, with the same tone and link", () => {
    const english = explainStop("awaiting_approval", bare);
    const french = explainStop("awaiting_approval", bare, fr);
    expect(french.text).not.toBe(english.text);
    expect(french.tone).toBe(english.tone);
    expect(french.link?.href).toBe(english.link?.href);
    expect(french.link?.label).toBe("Ouvrir Approbations");
  });
});
