import { describe, expect, it } from "vitest";

import {
  allowanceNotice,
  describeConversation,
  describeCost,
  describeRemaining,
  formatMicroUsd,
  formatTokens,
} from "./usage-meter";

const none = {
  prompt_tokens: 0,
  completion_tokens: 0,
  cached_prompt_tokens: 0,
  cost_micro_usd: 0,
  unpriced_calls: 0,
};

describe("formatMicroUsd", () => {
  it("shows exactly nothing as $0 and tiny amounts with four places", () => {
    expect(formatMicroUsd(0)).toBe("$0");
    expect(formatMicroUsd(4_200)).toBe("$0.0042");
  });
  it("uses cents above a cent and whole dollars above ten", () => {
    expect(formatMicroUsd(1_270_000)).toBe("$1.27");
    expect(formatMicroUsd(25_000_000)).toBe("$25");
  });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_234)).toBe("1.2k");
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(3_400_000)).toBe("3.4M");
  });
});

describe("describeCost", () => {
  it("names unpriced calls beside the cost instead of dropping them", () => {
    expect(describeCost({ ...none, cost_micro_usd: 400_000, unpriced_calls: 2 })).toBe(
      "$0.40 plus 2 unpriced calls",
    );
    expect(describeCost({ ...none, cost_micro_usd: 400_000, unpriced_calls: 1 })).toBe(
      "$0.40 plus 1 unpriced call",
    );
  });
  it("does not print $0 over a conversation nobody could price", () => {
    expect(describeCost({ ...none, unpriced_calls: 3 })).toBe("3 unpriced calls");
  });
});

describe("describeConversation", () => {
  it("says so when nothing has been spent", () => {
    expect(describeConversation(none)).toBe("No model use yet");
  });
  it("does not add the cached subset to the token count", () => {
    const text = describeConversation({
      ...none,
      prompt_tokens: 1_000,
      completion_tokens: 200,
      cached_prompt_tokens: 900,
      cost_micro_usd: 3_000,
    });
    expect(text).toBe("1.2k tokens · $0.0030");
  });
});

describe("allowanceNotice", () => {
  const budget = { daily_token_budget: 100, daily_cost_budget_micro_usd: 0 };
  it("is silent when unlimited or comfortably inside the budget", () => {
    expect(allowanceNotice({ ...budget, level: "unlimited" }).text).toBeNull();
    expect(allowanceNotice({ ...budget, level: "ok", percent: 40, basis: "tokens" }).text).toBeNull();
  });
  it("names what is running out, tokens or spending", () => {
    expect(
      allowanceNotice({ ...budget, level: "warning", percent: 83, basis: "tokens" }).text,
    ).toBe("83% of today's token allowance is used.");
    expect(
      allowanceNotice({ ...budget, level: "warning", percent: 91, basis: "cost" }).text,
    ).toBe("91% of today's spending allowance is used.");
  });
  it("says the next message will be refused when exhausted", () => {
    const notice = allowanceNotice({ ...budget, level: "exhausted", percent: 100, basis: "tokens" });
    expect(notice.level).toBe("exhausted");
    expect(notice.text).toContain("refused");
  });
});

describe("describeRemaining", () => {
  it("reports what is left in the unit the percentage was about", () => {
    const today = { ...none, prompt_tokens: 600, completion_tokens: 100, cost_micro_usd: 2_000_000 };
    expect(
      describeRemaining(today, {
        daily_token_budget: 1_000,
        daily_cost_budget_micro_usd: 5_000_000,
        basis: "cost",
      }),
    ).toBe("$3.00 left today");
    expect(
      describeRemaining(today, {
        daily_token_budget: 1_000,
        daily_cost_budget_micro_usd: 0,
        basis: "tokens",
      }),
    ).toBe("300 tokens left today");
  });
  it("is null when there is no ceiling", () => {
    expect(
      describeRemaining(none, { daily_token_budget: 0, daily_cost_budget_micro_usd: 0, basis: null }),
    ).toBeNull();
  });
});
