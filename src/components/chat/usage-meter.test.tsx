import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UsageMeter } from "@/components/chat/usage-meter";
import { api } from "@/lib/api-client";
import type { ConversationUsage } from "@/types/api";

const day = {
  prompt_tokens: 1_000,
  completion_tokens: 200,
  cached_prompt_tokens: 0,
  cost_micro_usd: 3_000,
  unpriced_calls: 0,
};

function usage(allowance: ConversationUsage["allowance"]): ConversationUsage {
  return { conversation: day, today: day, allowance };
}

afterEach(() => vi.restoreAllMocks());

describe("UsageMeter", () => {
  it("renders nothing until the server has said something", () => {
    vi.spyOn(api, "conversationUsage").mockReturnValue(new Promise(() => {}));
    const { container } = render(<UsageMeter conversationId="c1" live={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the live sums and warns from 80 percent, naming what is running out", () => {
    render(
      <UsageMeter
        conversationId="c1"
        live={usage({
          daily_token_budget: 1_400,
          daily_cost_budget_micro_usd: 0,
          percent: 86,
          level: "warning",
          basis: "tokens",
        })}
      />,
    );
    expect(screen.getByText(/1\.2k tokens · \$0\.0030/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("86% of today's token allowance is used.");
  });

  it("fetches once for an existing conversation and says nothing when comfortable", async () => {
    const spy = vi.spyOn(api, "conversationUsage").mockResolvedValue(
      usage({
        daily_token_budget: 100_000,
        daily_cost_budget_micro_usd: 0,
        percent: 1,
        level: "ok",
        basis: "tokens",
      }),
    );
    render(<UsageMeter conversationId="c1" live={null} />);
    await waitFor(() => expect(screen.getByTestId("usage-meter")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is absent, not an error, when the usage cannot be read", async () => {
    const spy = vi.spyOn(api, "conversationUsage").mockRejectedValue(new Error("down"));
    const { container } = render(<UsageMeter conversationId="c1" live={null} />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
