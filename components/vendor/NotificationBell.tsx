"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
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

const POLL_MS = 60_000;

function severityIcon(sev: Severity) {
  if (sev === "critical")
    return <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />;
  if (sev === "warning")
    return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
  return <Info className="h-4 w-4 shrink-0 text-blue-500" />;
}

function severityRail(sev: Severity) {
  if (sev === "critical") return "border-l-rose-500";
  if (sev === "warning") return "border-l-amber-500";
  return "border-l-blue-500";
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/notifications", {
        cache: "no-store",
      });
      if (res.ok) {
        const j = await res.json();
        setItems(Array.isArray(j?.items) ? j.items : []);
        setTotal(Number(j?.total ?? 0));
      }
    } catch {
      /* non-fatal: leave the last good state */
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount + poll every ~60s.
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Refresh when the panel is opened.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const badge = total > 9 ? "9+" : String(total);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-primary-foreground/90 transition hover:bg-white/15"
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[color:var(--ring,theme(colors.blue.700))]">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border bg-white text-foreground shadow-xl sm:w-96">
          <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {total > 0 && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                {total} alert{total === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500/70" />
                <p className="text-sm text-muted-foreground">
                  {loading ? "Checking…" : "You're all caught up ✅"}
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((it) => (
                  <li key={it.key}>
                    <button
                      type="button"
                      onClick={() => go(it.href)}
                      className={`flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition hover:bg-slate-50 ${severityRail(
                        it.severity,
                      )}`}
                    >
                      <span className="mt-0.5">{severityIcon(it.severity)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {it.title}
                          </span>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                            {it.count}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {it.detail}
                        </span>
                      </span>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => go("/vendor/notifications")}
            className="flex w-full items-center justify-center gap-1 border-t bg-slate-50/60 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-slate-100"
          >
            View all
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
