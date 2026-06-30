"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, KeyRound, AlertCircle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function VendorForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/vendor/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      setBusy(false);
      if (!json?.success) {
        setError(json?.message || "Could not send reset link.");
        return;
      }
      setSent(true);
      toast.success("Reset link sent. Check your email.");
    } catch {
      setBusy(false);
      setError("Could not send reset link.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-primary/5 via-background to-background px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-700 text-sm font-bold text-primary-foreground">
            MK
          </div>
          <div className="font-semibold">MadenKorea Vendor Portal</div>
        </div>

        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="h-5 w-5" />
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link.
        </p>

        {sent ? (
          <div className="mt-6 rounded-md border border-green-300 bg-green-50 px-3 py-3 text-sm text-green-700">
            If an account exists for <b>{email}</b>, a reset link is on its way.
            Check your inbox (and spam folder).
          </div>
        ) : (
          <>
            {error && (
              <div className="mt-5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <form className="mt-5 space-y-4" onSubmit={onSubmit} noValidate>
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="you@company.com"
                    className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
          </>
        )}

        <div className="mt-6 text-center text-sm">
          <Link
            href="/vendor/login"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
