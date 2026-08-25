"use client";

import { useAuth } from "@/lib/auth-context";

export default function SignOutButton() {
  const { logout } = useAuth();
  return (
    <button onClick={() => void logout()} className="text-sm font-medium text-muted hover:text-accent" type="button">
      Sign out
    </button>
  );
}
