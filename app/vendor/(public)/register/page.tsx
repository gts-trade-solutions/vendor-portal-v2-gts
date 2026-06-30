"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import Link from "next/link";

type Draft = {
  authEmail: string;
  displayName: string;
  legalName: string;
  slug: string;
  contactEmail: string;
  phone: string;
  gstin: string;
  website: string;
  addr: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  agree: boolean;
};

const DRAFT_KEY = "vendor_apply_draft_v1";

export default function VendorRegisterPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [authReady, setAuthReady] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string>("");

  // auth credentials (only used when signed out)
  const [authEmail, setAuthEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // vendor form
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [slug, setSlug] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [website, setWebsite] = useState("");
  const [addr, setAddr] = useState({
    line1: "",
    line2: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
  });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  const signedIn = status === "authenticated";

  const draft: Draft = useMemo(() => ({
    authEmail,
    displayName,
    legalName,
    slug,
    contactEmail,
    phone,
    gstin,
    website,
    addr,
    agree,
  }), [authEmail, displayName, legalName, slug, contactEmail, phone, gstin, website, addr, agree]);

  useEffect(() => {
    // Wait until NextAuth resolves the session.
    if (status === "loading") return;

    (async () => {
      // 1) hydrate session from NextAuth
      const email = session?.user?.email || "";
      setSessionEmail(email);

      // if signed in, default authEmail/contactEmail from session
      if (email) {
        setAuthEmail(email);
        setContactEmail((prev) => prev || email);
      }

      // 2) load draft (if exists) — helps if email verification is ON
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw) as Draft;
          setAuthEmail((prev) => prev || d.authEmail || "");
          setDisplayName((prev) => prev || d.displayName || "");
          setLegalName((prev) => prev || d.legalName || "");
          setSlug((prev) => prev || d.slug || "");
          setContactEmail((prev) => prev || d.contactEmail || "");
          setPhone((prev) => prev || d.phone || "");
          setGstin((prev) => prev || d.gstin || "");
          setWebsite((prev) => prev || d.website || "");
          setAddr((prev) => ({
            ...prev,
            ...(d.addr || {}),
            country: (d.addr?.country || prev.country || "India"),
          }));
          setAgree((prev) => prev || !!d.agree);
        }
      } catch {}

      // 3) if signed in and already vendor → go dashboard
      if (session?.user) {
        try {
          const res = await fetch("/api/vendor/me");
          const { vendor } = await res.json();
          if (vendor?.status) {
            router.replace("/vendor");
            return;
          }
        } catch {}
      }

      setAuthReady(true);
    })();
  }, [router, status, session]);

  const submitVendorApplication = async () => {
    const address_json = {
      line1: addr.line1,
      line2: addr.line2 || null,
      city: addr.city,
      state: addr.state,
      pincode: addr.pincode,
      country: addr.country || "India",
    };

    const res = await fetch("/api/vendor/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        p_display_name: displayName,
        p_legal_name: legalName || null,
        p_slug: slug || null,
        p_email: (contactEmail || authEmail || null),
        p_phone: phone || null,
        p_gstin: gstin || null,
        p_website: website || null,
        p_address_json: address_json,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Could not submit application");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!agree) {
      toast.error("Please accept the terms to continue.");
      return;
    }

    // Save draft early (so if verification is required, they don’t lose the form)
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}

    setBusy(true);

    try {
      // If signed out: create auth account (vendor-only signup, MySQL/NextAuth)
      if (!signedIn) {
        if (!authEmail.trim()) throw new Error("Login email is required");
        if (password.length < 8) throw new Error("Password must be at least 8 characters");
        if (password !== confirmPassword) throw new Error("Passwords do not match");

        const r = await fetch("/api/vendor/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: authEmail.trim(),
            password,
            full_name: displayName || null,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 409) {
          throw new Error("An account with this email already exists. Please sign in instead.");
        }
        if (!r.ok || !j.ok) {
          throw new Error(j.error || "Could not create account");
        }

        // Sign them in immediately (no email confirmation in the MySQL flow).
        const si = await signIn("credentials", {
          email: authEmail.trim(),
          password,
          redirect: false,
        });
        if (si?.error) {
          throw new Error("Account created but sign-in failed. Please sign in manually.");
        }

        setSessionEmail(authEmail.trim());
        setContactEmail((prev) => prev || authEmail.trim());
      }

      // Now we have a session → submit vendor application
      await submitVendorApplication();

      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      toast.success("Application submitted! We’ll review and notify you.");
      router.replace("/vendor"); // VendorGate will show pending/approved UI
    } catch (err: any) {
      toast.error(err?.message || "Could not submit application");
    } finally {
      setBusy(false);
    }
  };

  if (!authReady) {
    return <div className="container mx-auto py-12 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background py-12">
      <div className="mx-auto mb-6 flex max-w-3xl items-center gap-3 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-700 text-sm font-bold text-primary-foreground">
          MK
        </div>
        <div className="leading-tight">
          <div className="font-semibold">MadenKorea</div>
          <div className="text-xs text-muted-foreground">Vendor Portal</div>
        </div>
      </div>
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle className="text-2xl">Vendor Registration</CardTitle>
          <CardDescription>
            {signedIn ? `Signed in as ${sessionEmail}` : "Create a vendor login + submit your application."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form className="space-y-6" onSubmit={onSubmit}>
            {/* Auth section (only when signed out) */}
            {!signedIn && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="font-medium">Vendor Login Details</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Label>Login Email *</Label>
                    <Input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>Password *</Label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>Confirm Password *</Label>
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Already have a vendor login?{" "}
                  <Link className="underline" href="/vendor/login?redirect=/vendor/register">
                    Sign in
                  </Link>
                </p>
              </div>
            )}

            {/* Vendor business details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Display Name *</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              </div>
              <div>
                <Label>Legal Name</Label>
                <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
              </div>

              <div>
                <Label>Preferred Slug</Label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  placeholder="e.g. my-brand"
                />
              </div>

              <div>
                <Label>Website</Label>
                <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
              </div>

              <div>
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder={authEmail || "vendor@domain.com"}
                />
              </div>

              <div>
                <Label>Phone</Label>
                <Input inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>

              <div className="md:col-span-2">
                <Label>GSTIN</Label>
                <Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-3">
              <p className="font-medium">Business Address</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Address Line 1 *</Label>
                  <Input value={addr.line1} onChange={(e) => setAddr((a) => ({ ...a, line1: e.target.value }))} required />
                </div>
                <div>
                  <Label>Address Line 2</Label>
                  <Input value={addr.line2} onChange={(e) => setAddr((a) => ({ ...a, line2: e.target.value }))} />
                </div>
                <div>
                  <Label>City *</Label>
                  <Input value={addr.city} onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))} required />
                </div>
                <div>
                  <Label>State *</Label>
                  <Input value={addr.state} onChange={(e) => setAddr((a) => ({ ...a, state: e.target.value }))} required />
                </div>
                <div>
                  <Label>Pincode *</Label>
                  <Input inputMode="numeric" maxLength={6} value={addr.pincode} onChange={(e) => setAddr((a) => ({ ...a, pincode: e.target.value }))} required />
                </div>
                <div>
                  <Label>Country *</Label>
                  <Input value={addr.country} onChange={(e) => setAddr((a) => ({ ...a, country: e.target.value }))} required />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="agree" checked={agree} onCheckedChange={(v) => setAgree(!!v)} />
              <Label htmlFor="agree" className="text-sm">
                I confirm the above details are accurate and agree to the terms.
              </Label>
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? "Submitting…" : "Submit Application"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/vendor/login">Back to Login</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
