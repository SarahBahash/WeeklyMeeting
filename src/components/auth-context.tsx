"use client";
import { createContext, useContext } from "react";
import type { AuthUser, Permission } from "@/lib/auth/permissions";

interface Ctx { user: AuthUser; permissions: Permission[] }
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ value, children }: { value: Ctx; children: React.ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return { ...ctx, can: (p: Permission) => ctx.permissions.includes(p) };
}
