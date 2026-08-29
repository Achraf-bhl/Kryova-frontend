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
