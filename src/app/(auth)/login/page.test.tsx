import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AuthProvider } from "@/lib/auth-context";
import LoginPage from "./page";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  push.mockReset();
  localStorage.clear();
});

afterEach(() => {
  mockFetch.mockReset();
});

function renderLoginPage() {
  return render(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "engineer@kryova.test");
  await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
}

describe("LoginPage", () => {
  it("renders the email and password fields", () => {
    renderLoginPage();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("disables the submit button while the login request is pending", async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: unknown) => void = () => {};
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderLoginPage();
    await fillCredentials(user);

    const submit = screen.getByRole("button", { name: /sign in/i });
    await user.click(submit);
    expect(submit).toBeDisabled();

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: "1", email: "e", full_name: null, is_active: true, created_at: "now" },
        csrf_token: "csrf",
      }),
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  it("shows the backend's error message on a 401 and never writes a token to localStorage", async () => {
    const user = userEvent.setup();
    // api-client's request() auto-retries any 401 through /auth/refresh once
    // (see api-client.test.ts's "refreshes once after unauthorized response").
    // A fresh login attempt has no refresh cookie either, so that retry also
    // fails and the original 401's detail is what should reach the user.
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ detail: "Incorrect email or password" }),
      })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    renderLoginPage();
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Incorrect email or password")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    // Auth is httpOnly cookies + CSRF header (see CLAUDE.md) -- a token in
    // localStorage was a real, shipped bug once. Assert it explicitly rather
    // than trusting that no code path happens to write one.
    expect(localStorage.length).toBe(0);
  });
});

/**
 * P1.7. `/auth/login` now answers with a session **or** a challenge, and this
 * is the one route where reading one as the other means showing a signed-out
 * person a dashboard.
 */
describe("LoginPage when the account has a second factor", () => {
  const challenge = {
    mfa_required: true,
    challenge_token: "challenge-abc",
    expires_in_seconds: 300,
    recovery_available: true,
  };

  it("asks for a code instead of navigating", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => challenge });
    renderLoginPage();
    await fillCredentials(user);

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByLabelText("Six-digit code")).toBeInTheDocument();
    // The whole point: a challenge must not be mistaken for a session.
    expect(push).not.toHaveBeenCalled();
  });

  it("unmounts the password field rather than hiding it", async () => {
    // A browser autofilling a hidden password input on the code step is how a
    // password gets submitted to the wrong endpoint.
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => challenge });
    renderLoginPage();
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await screen.findByLabelText("Six-digit code");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("mentions recovery codes only when some are left", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ ...challenge, recovery_available: false }),
    });
    renderLoginPage();
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await screen.findByLabelText("Six-digit code");
    // Offering a route that cannot work is worse than not offering it.
    expect(screen.queryByText(/recovery code/i)).not.toBeInTheDocument();
  });

  it("navigates once the code is accepted", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => challenge })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          user: {
            id: "1",
            email: "e",
            full_name: null,
            is_active: true,
            created_at: "now",
            is_verified: true,
          },
          csrf_token: "csrf",
        }),
      });
    renderLoginPage();
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("keeps the user on the code step and clears the field when the code is wrong", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => challenge })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ detail: "That code is not valid." }),
      })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    renderLoginPage();
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const field = await screen.findByLabelText("Six-digit code");
    await user.type(field, "000000");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText("That code is not valid.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    // Cleared, so the next attempt does not append to a stale six digits.
    await waitFor(() => expect(field).toHaveValue(""));
  });
});
