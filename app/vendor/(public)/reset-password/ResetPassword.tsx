"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Lock, Eye, EyeOff, ShieldCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function VendorResetPasswordPage() {
  const sp = useSearchParams();
  const token = sp.get("token") || "";

  const [ready, setReady] = useState(false);
  const [validToken, setValidToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!token) {
          setValidToken(false);
          setReady(true);
          return;
        }
        const res = await fetch(
          `/api/vendor/auth/reset-password?token=${encodeURIComponent(token)}`
        );
        const json = await res.json().catch(() => ({}));
        setValidToken(!!json?.valid);
        setReady(true);
      } catch {
        setValidToken(false);
        setReady(true);
      }
    })();
  }, [token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/vendor/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Could not update password.");
        return;
      }
      setDone(true);
      toast.success("Password updated. Please sign in.");
    } catch {
      setBusy(false);
      setError("Could not update password.");
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
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Set a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a strong password (at least 8 characters).
        </p>

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!ready ? (
          <div className="mt-6 text-sm text-muted-foreground">Preparing reset…</div>
        ) : done ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-md border border-green-300 bg-green-50 px-3 py-3 text-sm text-green-700">
              Your password has been updated. You can now sign in with your new password.
            </div>
            <Link
              href="/vendor/login"
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Go to login
            </Link>
          </div>
        ) : !validToken ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
              This reset link is invalid or has expired. Please request a new one.
            </div>
            <Link
              href="/vendor/forgot-password"
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Request a new link
            </Link>
          </div>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={onSubmit} noValidate>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">New password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="••••••••"
                  className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-10 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Confirm password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="••••••••"
                  className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
