// /lib/contexts/AuthContext.tsx
"use client";

import { createContext, useContext, useMemo } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

type UserRole = "customer" | "admin";

type SessionUser = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  role?: UserRole; // carried on the NextAuth JWT/session
};

type AuthContextType = {
  user: SessionUser | null;
  isAuthenticated: boolean;
  ready: boolean;
  isAdmin: boolean;
  hasRole: (role: UserRole) => boolean;
  login: (c: { email: string; password: string }) => Promise<void>;
  register: (r: {
    full_name: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // NextAuth session is the single source of truth. The JWT carries id + role
  // (stamped in authOptions); name/email/image come straight off the session.
  const { data: session, status, update } = useSession();

  // `ready` mirrors the old contract: false while auth is resolving, true once
  // we know whether the visitor is signed in or not.
  const ready = status !== "loading";

  const naUser = session?.user as
    | {
        id?: string;
        email?: string | null;
        name?: string | null;
        image?: string | null;
        role?: UserRole;
      }
    | undefined;

  const user: SessionUser | null =
    naUser?.id
      ? {
          id: naUser.id,
          email: naUser.email ?? null,
          full_name: naUser.name ?? null,
          avatar_url: naUser.image ?? null,
          role: (naUser.role as UserRole) ?? "customer",
        }
      : null;

  const login = async (c: { email: string; password: string }) => {
    const res = await signIn("credentials", {
      email: c.email,
      password: c.password,
      redirect: false,
    });
    if (res?.error) throw new Error("Invalid email or password");
    // useSession updates reactively once the session cookie is set.
  };

  const register = async (r: {
    full_name: string;
    email: string;
    password: string;
  }) => {
    // Registration is server-side (RPC port lands in a later phase). Create the
    // account, then sign in via NextAuth to establish the session.
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: r.email,
        password: r.password,
        full_name: r.full_name,
      }),
    });
    const j = await res.json().catch(() => ({} as any));
    if (!res.ok || !j?.ok) {
      const code = j?.error;
      throw new Error(
        code === "EMAIL_EXISTS"
          ? "An account with this email already exists."
          : code === "WEAK_PASSWORD"
            ? "Password must be at least 6 characters."
            : code || "Registration failed"
      );
    }
    const si = await signIn("credentials", {
      email: r.email,
      password: r.password,
      redirect: false,
    });
    if (si?.error) {
      throw new Error("Registered, but sign-in failed — please log in.");
    }
  };

  const logout = async () => {
    await signOut({ redirect: false });
  };

  const refreshProfile = async () => {
    // Re-fetch the session so freshly-changed fields propagate.
    await update();
  };

  const hasRole = (role: UserRole) => user?.role === role;
  const isAdmin = hasRole("admin");

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      ready,
      isAdmin,
      hasRole,
      login,
      register,
      logout,
      refreshProfile,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, user?.role, ready]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
