"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type VendorInfo = {
  id: string;
  display_name: string;
  slug: string | null;
  status: "pending" | "approved" | "rejected" | "disabled";
  role: "owner" | "manager" | "staff" | null;
  rejected_reason?: string | null;
  email?: string | null;
};

function coerceVendor(data: any): VendorInfo | null {
  const arr = Array.isArray(data) ? data : data ? [data] : [];
  const v = arr[0];
  if (!v || !v.id) return null;
  return {
    id: v.id,
    display_name: v.display_name,
    slug: v.slug ?? null,
    status: v.status,
    role: v.role ?? null,
    rejected_reason: v.rejected_reason ?? null,
    email: v.email ?? null,
  };
}

type Phase =
  | "initial-checking"   // only before first decision
  | "approved"           // sticky; never changes afterward
  | "no-vendor"
  | "pending"
  | "rejected"
  | "disabled"
  | "error";

const PUBLIC_VENDOR_PREFIXES = [
  "/vendor/login",
  "/vendor/register",
  "/vendor/forgot-password",
];
const isPublic = (pathname: string) =>
  PUBLIC_VENDOR_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

export default function VendorGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const mounted = useRef(true);
  const { data: session, status } = useSession();

  // NOTE: all hooks must run unconditionally (Rules of Hooks). The public-page
  // short-circuit happens AFTER every hook is declared (see render + effect).
  const [phase, setPhase] = useState<Phase>("initial-checking");
  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const approvedOnce = useRef(false); // sticky flag
  const checkedOnce = useRef(false);  // guards the one-time vendor check
  const publicPage = isPublic(pathname);

  const gotoLogin = () => {
    router.replace(`/vendor/login?redirect=${encodeURIComponent(pathname)}`);
  };

  // ---- ONE-TIME CHECK ONLY (after the NextAuth session resolves) ----
  useEffect(() => {
    mounted.current = true;

    // Public pages (login/register/forgot) render children with no vendor check.
    if (publicPage) return;

    // Wait for the session to resolve before deciding anything.
    if (status === "loading") return;

    // React to an explicit sign-out: drop the sticky flag and bounce to login.
    if (status === "unauthenticated") {
      approvedOnce.current = false;
      checkedOnce.current = false;
      gotoLogin();
      return;
    }

    // status === "authenticated" — run the vendor check exactly once.
    if (checkedOnce.current) return;
    checkedOnce.current = true;

    (async () => {
      // session already confirmed by `status === "authenticated"`.
      if (!session?.user) {
        // First hit, no session -> go login (only time we redirect automatically)
        gotoLogin();
        return;
      }

      // vendor check via the NextAuth-scoped, MySQL-backed gate API.
      let body: any = null;
      try {
        const res = await fetch("/api/vendor/me", { cache: "no-store" });
        if (!mounted.current) return;
        if (res.status === 401) {
          gotoLogin();
          return;
        }
        if (!res.ok) {
          setPhase("error");
          return;
        }
        body = await res.json().catch(() => null);
      } catch {
        if (!mounted.current) return;
        setPhase("error");
        return;
      }
      if (!mounted.current) return;

      const v = coerceVendor(body?.vendor ?? null);
      setVendor(v);

      if (!v) { setPhase("no-vendor"); return; }

      if (v.status === "approved") {
        approvedOnce.current = true;
        setPhase("approved"); // sticky forever
        return;
      }
      if (v.status === "pending")  { setPhase("pending");  return; }
      if (v.status === "rejected") { setPhase("rejected"); return; }
      setPhase("disabled");
    })();

    return () => {
      mounted.current = false;
    };
    // Re-runs when the session status changes so we can react to sign-out;
    // the `checkedOnce` ref keeps the vendor check itself one-time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, publicPage]);

  // Public pages render without any gating (all hooks above ran unconditionally).
  if (publicPage) return <>{children}</>;

  // Once approved, ALWAYS render children; never block again
  if (approvedOnce.current || phase === "approved") return <>{children}</>;

  // Pre-approval render states (only during the first visit)
  if (phase === "initial-checking") {
    return (
      <div className="container mx-auto py-16 text-muted-foreground">
        Loading vendor workspace…
      </div>
    );
  }

  if (phase === "no-vendor") {
    return (
      <div className="container mx-auto py-16">
        <Card className="max-w-xl mx-auto text-center">
          <CardHeader><CardTitle className="text-2xl">Become a Vendor</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">You don’t have a vendor account yet.</p>
            <Button asChild size="lg"><Link href="/vendor/register">Create Vendor Account</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === "pending") {
    return (
      <div className="container mx-auto py-16">
        <Card className="max-w-xl mx-auto text-center">
          <CardHeader><CardTitle className="text-2xl">Application in Review</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground">
              Thanks for applying{vendor?.display_name ? `, ${vendor.display_name}` : ""}. We’ll notify you once approved.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === "rejected" || phase === "disabled") {
    return (
      <div className="container mx-auto py-16">
        <Card className="max-w-xl mx-auto text-center">
          <CardHeader><CardTitle className="text-2xl">
            {phase === "rejected" ? "Application Rejected" : "Account Disabled"}
          </CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {vendor?.rejected_reason
              ? <p className="text-sm text-muted-foreground">Reason: {vendor.rejected_reason}</p>
              : <p className="text-muted-foreground">Please contact support.</p>}
            <Button asChild variant="outline"><Link href="/">Back to Home</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="container mx-auto py-16 text-destructive">
        Something went wrong. Please refresh or try again.
      </div>
    );
  }

  return null;
}
