"use client";

import { createContext, useCallback, useContext, useState } from "react";

import { api } from "@/lib/api-client";
import type { UserRead } from "@/types/api";

interface AuthState {
  user: UserRead | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserRead | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api.login(email, password);
    setUser(session.user);
  }, []);

  const register = useCallback(async (email: string, password: string, fullName: string) => {
    await api.register(email, password, fullName);
    await login(email, password);
  }, [login]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading: false, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
