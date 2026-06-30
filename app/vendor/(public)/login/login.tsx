'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Eye,
  EyeOff,
  LogIn,
  Mail,
  Lock,
  AlertCircle,
  Package,
  FileText,
  BarChart3,
} from 'lucide-react';

type VendorInfo = {
  id: string;
  display_name: string;
  slug: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'disabled';
  role: 'owner' | 'manager' | 'staff' | null;
  rejected_reason?: string | null;
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
  } as VendorInfo;
}

function friendlyAuthError(message?: string) {
  const m = (message || '').toLowerCase();
  if (m.includes('invalid login credentials'))
    return 'Incorrect email or password. Please try again.';
  if (m.includes('email not confirmed'))
    return 'Please confirm your email address before signing in.';
  if (m.includes('too many') || m.includes('rate limit'))
    return 'Too many attempts. Please wait a moment and try again.';
  if (m.includes('failed to fetch') || m.includes('network'))
    return 'Network error — check your connection and try again.';
  return message || 'Login failed. Please try again.';
}

export default function VendorLoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const redirect = sp.get('redirect') || '/vendor';

  const { data: session, status } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Smart-redirect if already signed in.
  useEffect(() => {
    if (status === 'loading') return;
    let mounted = true;
    (async () => {
      if (!session?.user) {
        setHydrated(true);
        return;
      }
      try {
        const res = await fetch('/api/vendor/me', { cache: 'no-store' });
        if (!mounted) return;
        if (!res.ok) {
          setHydrated(true);
          return;
        }
        const body = await res.json().catch(() => ({}));
        const v = coerceVendor(body?.vendor ?? null);
        setHydrated(true);
        router.replace(v ? redirect : '/vendor/register');
      } catch {
        if (mounted) setHydrated(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [router, redirect, status, session?.user]);

  const validate = () => {
    if (!email.trim()) return 'Please enter your email.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return 'Please enter a valid email address.';
    if (!password) return 'Please enter your password.';
    return null;
  };

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    const res = await signIn('credentials', {
      email: email.trim(),
      password,
      redirect: false,
    });

    if (res?.error) {
      setBusy(false);
      setError(friendlyAuthError('invalid login credentials'));
      return;
    }

    try {
      const meRes = await fetch('/api/vendor/me', { cache: 'no-store' });
      setBusy(false);
      if (!meRes.ok) {
        setError('Signed in, but we could not load your vendor status. Please retry.');
        return;
      }
      const body = await meRes.json().catch(() => ({}));
      const v = coerceVendor(body?.vendor ?? null);
      router.replace(v ? redirect : '/vendor/register');
    } catch {
      setBusy(false);
      setError('Signed in, but we could not load your vendor status. Please retry.');
    }
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
      <div className="mx-auto grid w-full max-w-5xl items-stretch gap-0 px-4 py-10 lg:grid-cols-2">
        {/* Brand panel */}
        <div className="hidden flex-col justify-between rounded-l-2xl bg-gradient-to-br from-primary to-blue-700 p-10 text-primary-foreground lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-sm font-bold backdrop-blur">
              MK
            </div>
            <div className="leading-tight">
              <div className="font-semibold">MadenKorea</div>
              <div className="text-xs text-primary-foreground/70">Vendor Portal</div>
            </div>
          </div>

          <div className="space-y-5">
            <h2 className="text-2xl font-bold leading-snug">
              Inventory, invoicing &amp; reports — in one workspace.
            </h2>
            <ul className="space-y-3 text-sm text-primary-foreground/90">
              <li className="flex items-center gap-3">
                <Package className="h-5 w-5 shrink-0" />
                Unit-level stock &amp; expiry tracking
              </li>
              <li className="flex items-center gap-3">
                <FileText className="h-5 w-5 shrink-0" />
                GST invoices with payments &amp; outstanding
              </li>
              <li className="flex items-center gap-3">
                <BarChart3 className="h-5 w-5 shrink-0" />
                Financial-year sales &amp; outstanding reports
              </li>
            </ul>
          </div>

          <div className="text-xs text-primary-foreground/60">
            © {new Date().getFullYear()} MadenKorea
          </div>
        </div>

        {/* Form panel */}
        <div className="flex flex-col justify-center rounded-2xl border bg-card p-8 shadow-lg lg:rounded-l-none lg:border-l-0">
          {/* Mobile brand */}
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-700 text-sm font-bold text-primary-foreground">
              MK
            </div>
            <div className="font-semibold">MadenKorea Vendor Portal</div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your vendor workspace.
          </p>

          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form className="mt-5 space-y-4" onSubmit={onLogin} noValidate>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
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

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
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
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="text-right">
                <Link
                  href="/vendor/forgot-password"
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy || !hydrated}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Don&apos;t have a vendor account?{' '}
            <Link href="/vendor/register" className="font-medium text-primary hover:underline">
              Register
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
