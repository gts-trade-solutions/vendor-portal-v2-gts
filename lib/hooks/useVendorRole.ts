"use client";

import { useEffect, useState } from "react";

/**
 * Reads the current user's vendor role from the MySQL-backed /api/vendor/me
 * gate (NextAuth-scoped). owner/manager => admin (full CRUD). staff => view-only.
 */
export function useVendorRole() {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      let r: string | null = null;
      try {
        const res = await fetch("/api/vendor/me");
        const json = await res.json();
        r = (json?.vendor?.role as string) ?? null;
      } catch {
        r = null;
      }
      if (active) {
        setRole(r);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const isAdmin = role === "owner" || role === "manager";
  return { role, loading, isAdmin, isViewer: !loading && !isAdmin };
}
