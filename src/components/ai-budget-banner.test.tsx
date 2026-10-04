import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AIUsage } from "@/types/api";

import { AiBudgetBanner } from "./ai-budget-banner";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  mockFetch.mockReset();
  vi.useRealTimers();
});

function usage(overrides: Partial<AIUsage> = {}): AIUsage {
  return {
    today: {
      prompt_tokens: 0,
      completion_tokens: 0,
      cached_prompt_tokens: 0,
      cost_micro_usd: 0,
      unpriced_calls: 0,
    },
    allowance: { daily_token_budget: 0, daily_cost_budget_micro_usd: 0 },
    organisation_id: "org-1",
    organisation_caps: [],
    organisation_unpriced_calls: 0,
    notices: [],
    blocked: null,
    ...overrides,
  };
}

function reply(body: AIUsage) {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

const WARNING = {
  period: "month",
  percent: 82,
  level: "warning",
  message: "Your organisation has used 82% of this month's AI budget.",
};
const EXHAUSTED = {
  period: "day",
  percent: 100,
  level: "exhausted",
  message: "Your organisation has used all of today's AI budget.",
};

describe("AiBudgetBanner", () => {
  it("renders nothing when there is nothing to say", async () => {
    reply(usage());
    const { container } = render(<AiBudgetBanner />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a warning and lets it be dismissed", async () => {
    const user = userEvent.setup();
    reply(usage({ notices: [WARNING] }));
    render(<AiBudgetBanner />);

    expect(await screen.findByText(WARNING.message)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByText(WARNING.message)).not.toBeInTheDocument();
  });

  it("cannot dismiss an exhausted cap, because it is why the next request fails", async () => {
    reply(usage({ notices: [EXHAUSTED] }));
    render(<AiBudgetBanner />);

    expect(await screen.findByText(EXHAUSTED.message)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it("says why a turn would be refused, and says it once when a notice has the same words", async () => {
    reply(usage({ notices: [EXHAUSTED], blocked: EXHAUSTED.message }));
    render(<AiBudgetBanner />);

    await screen.findByText("The assistant cannot take a new request");
    expect(screen.getAllByText(EXHAUSTED.message)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it("shows a refusal that no notice explains", async () => {
    // A per-user allowance has no organisation notice at all.
    reply(usage({ blocked: "You have used today's AI allowance." }));
    render(<AiBudgetBanner />);

    expect(await screen.findByText("You have used today's AI allowance.")).toBeInTheDocument();
  });

  it("dismissing the warning does not hide the exhausted cap beside it", async () => {
    const user = userEvent.setup();
    reply(usage({ notices: [WARNING, EXHAUSTED] }));
    render(<AiBudgetBanner />);
    await screen.findByText(WARNING.message);

    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByText(WARNING.message)).not.toBeInTheDocument();
    expect(screen.getByText(EXHAUSTED.message)).toBeInTheDocument();
  });

  it("stays silent when the request fails", async () => {
    // The banner is furniture. A user whose network hiccups should not get an error about it
    // on top of whatever else is wrong.
    mockFetch.mockRejectedValue(new Error("offline"));
    const { container } = render(<AiBudgetBanner />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("reads again when the tab comes back, so a stale figure is not left on screen", async () => {
    reply(usage());
    render(<AiBudgetBanner />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    reply(usage({ notices: [WARNING] }));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(await screen.findByText(WARNING.message)).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("polls on a slow interval", async () => {
    vi.useFakeTimers();
    reply(usage());
    render(<AiBudgetBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
