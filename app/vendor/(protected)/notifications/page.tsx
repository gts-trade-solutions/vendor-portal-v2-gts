"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Bell,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";

type Severity = "critical" | "warning" | "info";
type NotificationItem = {
  key: string;
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  href: string;
};

function severityIcon(sev: Severity) {
  if (sev === "critical")
    return <AlertCircle className="h-6 w-6 text-rose-500" />;
  if (sev === "warning")
    return <AlertTriangle className="h-6 w-6 text-amber-500" />;
  return <Info className="h-6 w-6 text-blue-500" />;
}

function severityCard(sev: Severity) {
  if (sev === "critical") return "border-l-rose-500 bg-rose-50/40";
  if (sev === "warning") return "border-l-amber-500 bg-amber-50/40";
  return "border-l-blue-500 bg-blue-50/40";
}

function CardSkeleton() {
  return (
    <div className="h-24 w-full animate-pulse rounded-lg border border-l-4 border-l-slate-200 bg-slate-50" />
  );
}

export default function VendorNotificationsPage() {
  const router = useRouter();
  const { status } = useSession();

  const [gated, setGated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<NotificationItem[]>([]);

  // Gate: NextAuth session -> resolve vendor via /api/vendor/me.
  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      router.replace("/vendor/login");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/vendor/me", { cache: "no-store" });
        const j = res.ok ? await res.json() : null;
        const vendor = j?.vendor ?? null;
        if (cancelled) return;
        if (!vendor) {
          router.replace("/vendor");
          return;
        }
        setGated(true);
      } catch {
        if (!cancelled) router.replace("/vendor");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, router]);

  // Load notifications once gated.
  useEffect(() => {
    if (!gated) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/vendor/notifications", {
          cache: "no-store",
        });
        const j = res.ok ? await res.json() : null;
        if (!cancelled) setItems(Array.isArray(j?.items) ? j.items : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gated]);

  return (
    <div className="min-h-screen">
      <header className="border-b bg-gradient-to-r from-primary to-blue-700 text-primary-foreground shadow-sm">
        <div className="container mx-auto flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Bell className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Notifications</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-white/40 bg-white/10 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground"
            onClick={() => router.push("/vendor")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </header>

      <div className="container mx-auto max-w-3xl space-y-4 py-8">
        <div>
          <h2 className="text-xl font-semibold">Actionable alerts</h2>
          <p className="text-sm text-muted-foreground">
            Items that need your attention across inventory, invoices and
            orders.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500/70" />
              <div>
                <p className="text-lg font-semibold">You&apos;re all caught up ✅</p>
                <p className="text-sm text-muted-foreground">
                  No alerts right now. We&apos;ll let you know when something needs
                  attention.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((it) => (
              <Card
                key={it.key}
                className={`border-l-4 ${severityCard(it.severity)}`}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5">{severityIcon(it.severity)}</span>
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        {it.title}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                          {it.count}
                        </span>
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {it.detail}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(it.href)}
                  >
                    View
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
