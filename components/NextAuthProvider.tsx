"use client";

import { SessionProvider } from "next-auth/react";

// Client boundary that exposes the NextAuth session to the React tree
// (so AuthContext and any component can use `useSession()`).
export function NextAuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
