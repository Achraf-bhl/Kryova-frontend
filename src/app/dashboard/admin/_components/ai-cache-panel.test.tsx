import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AiCacheHealth } from "@/types/api";

import { AiCachePanel, formatTokens, percent } from "./ai-cache-panel";

function cache(overrides: Partial<AiCacheHealth> = {}): AiCacheHealth {
  return {
    turns: 60,
    prompt_tokens: 600_000,
    cached_prompt_tokens: 480_000,
    hit_rate: 0.8,
    recent_turns: 20,
    recent_hit_rate: 0.75,
    reported: true,
    alert: null,
    ...overrides,
  };
}

describe("AiCachePanel", () => {
  it("shows the rate, the recent rate and what the rate is made of", () => {
    render(<AiCachePanel cache={cache()} />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Last 20 turns")).toBeInTheDocument();
    expect(
      screen.getByText("480.0k of 600.0k input tokens at the cache price"),
    ).toBeInTheDocument();
  });

  it("says there is nothing yet when no turn ran, instead of showing 0%", () => {
    render(
      <AiCachePanel
        cache={cache({
          turns: 0,
          prompt_tokens: 0,
          cached_prompt_tokens: 0,
          hit_rate: null,
          recent_turns: 0,
          recent_hit_rate: null,
          reported: false,
        })}
      />,
    );
    expect(screen.getByText("No agent turns in this window yet.")).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it("calls an unreported cache unmeasured rather than zero", () => {
    render(
      <AiCachePanel
        cache={cache({ cached_prompt_tokens: 0, hit_rate: 0, recent_hit_rate: 0, reported: false })}
      />,
    );
    expect(screen.getByText(/does not report cached tokens/i)).toBeInTheDocument();
    expect(screen.getByText(/not measured/i)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("renders a recent rate that is null as a sentence, not as 0%", () => {
    render(<AiCachePanel cache={cache({ recent_turns: 6, recent_hit_rate: null })} />);
    expect(screen.getByText("not enough turns")).toBeInTheDocument();
    expect(screen.getByText("too few turns to compare")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("raises the server's alert as an alert", () => {
    const alert = "The prompt-cache hit rate fell from 85% over the earlier turns to 10%.";
    render(<AiCachePanel cache={cache({ alert, recent_hit_rate: 0.1 })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(alert);
  });

  it("raises no alert when the server sent none", () => {
    render(<AiCachePanel cache={cache()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("formatting", () => {
  it("rounds a rate to a whole percent and keeps a real zero as 0%", () => {
    expect(percent(0.846)).toBe("85%");
    expect(percent(0)).toBe("0%");
    expect(percent(null)).toBe("not enough turns");
  });

  it("shortens token counts", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(2_300_000)).toBe("2.3M");
  });
});
