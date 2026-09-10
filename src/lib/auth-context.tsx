"use client";

import { createContext, useCallback, useContext, useState } from "react";

import { api } from "@/lib/api-client";
import { isMfaChallenge } from "@/types/api";
import type { MfaChallenge, UserRead } from "@/types/api";

interface AuthState {
  user: UserRead | null;
  /**
   * Sign in. Resolves to `null` on success and to a challenge when the account
   * has a second factor (P1.7) — the caller renders the code step and calls
   * `completeMfa`.
   *
   * Returning the challenge rather than holding it in this context is
   * deliberate: a half-finished login is a property of the form the user is
   * looking at, not of the application's identity. Parking it here would leave
   * a pending challenge alive across a navigation, and the next page would have
   * to know to clear it.
   */
  login: (email: string, password: string) => Promise<MfaChallenge | null>;
  completeMfa: (challengeToken: string, code: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<MfaChallenge | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserRead | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    // Narrowed on `mfa_required`, never on which keys are present: on this
    // route reading a challenge as a session would show a signed-out person a
    // dashboard, and `"user" in result` gets that wrong silently.
    if (isMfaChallenge(result)) return result;
    setUser(result.user);
    return null;
  }, []);

  const completeMfa = useCallback(async (challengeToken: string, code: string) => {
    const session = await api.completeMfaLogin(challengeToken, code);
    setUser(session.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      await api.register(email, password, fullName);
      return login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, completeMfa, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
