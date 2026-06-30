"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Activity, ChevronLeft, ChevronRight, History } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ActivityRow = {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  meta: any;
  created_at: string | null;
};

const PAGE_SIZE = 50;

// Known actions to populate the filter dropdown. "All" is the empty value.
const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All actions" },
  { value: "invoice.create", label: "Invoice created" },
  { value: "invoice.update", label: "Invoice updated" },
  { value: "invoice.trash", label: "Invoice trashed" },
  { value: "invoice.restore", label: "Invoice restored" },
  { value: "invoice.purge", label: "Invoice purged" },
  { value: "invoice.duplicate", label: "Invoice duplicated" },
  { value: "payment.add", label: "Payment added" },
  { value: "payment.delete", label: "Payment deleted" },
  { value: "product.create", label: "Product created" },
  { value: "product.update", label: "Product updated" },
  { value: "product.delete", label: "Product deleted" },
  { value: "product.bulk_upsert", label: "Products imported" },
  { value: "product.link_inventory", label: "Inventory linked" },
  { value: "unit.create", label: "Units created" },
  { value: "unit.update", label: "Units updated" },
  { value: "unit.status", label: "Unit status changed" },
  { value: "unit.delete", label: "Units deleted" },
  { value: "fulfillment.pending", label: "Fulfillment: pending" },
  { value: "fulfillment.dispatched", label: "Fulfillment: dispatched" },
  { value: "fulfillment.delivered", label: "Fulfillment: delivered" },
  { value: "fulfillment.cancelled", label: "Fulfillment: cancelled" },
  { value: "company.create", label: "Company created" },
  { value: "company.update", label: "Company updated" },
  { value: "company.delete", label: "Company deleted" },
  { value: "member.add", label: "Member added" },
  { value: "member.remove", label: "Member removed" },
  { value: "profile.update", label: "Profile updated" },
];

function actionChipClass(action: string): string {
  if (action.startsWith("invoice.") || action.startsWith("payment."))
    return "bg-blue-100 text-blue-700";
  if (action.startsWith("product.") || action.startsWith("unit."))
    return "bg-emerald-100 text-emerald-700";
  if (action.startsWith("fulfillment."))
    return "bg-amber-100 text-amber-700";
  if (action.startsWith("member.") || action.startsWith("profile."))
    return "bg-violet-100 text-violet-700";
  if (action.startsWith("company.")) return "bg-slate-200 text-slate-700";
  return "bg-slate-100 text-slate-600";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return s <= 1 ? "just now" : `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function shortId(id: string | null): string {
  if (!id) return "";
  return id.length > 8 ? id.slice(0, 8) : id;
}

export default function ActivityLogPage() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();

  const [roleLoading, setRoleLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");

  // Resolve role from the vendor gate.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/vendor/me", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        const role = (json?.vendor?.role as string) ?? null;
        if (active) setIsAdmin(role === "owner" || role === "manager");
      } catch {
        if (active) setIsAdmin(false);
      } finally {
        if (active) setRoleLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (actionFilter) params.set("action", actionFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    try {
      const res = await fetch(`/api/vendor/activity?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || "Failed to load activity");
        setRows([]);
        setCount(0);
      } else {
        setRows((json?.data || []) as ActivityRow[]);
        setCount(Number(json?.count || 0));
      }
    } catch {
      toast.error("Failed to load activity");
      setRows([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, fromDate, toDate]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  // Reset to first page whenever a server-side filter changes.
  useEffect(() => {
    setPage(0);
  }, [actionFilter, fromDate, toDate]);

  // Client-side search across summary + actor.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = `${r.summary || ""} ${r.actor_email || ""} ${
        r.actor_name || ""
      } ${r.action}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  if (sessionStatus === "loading" || roleLoading) {
    return (
      <div className="container mx-auto py-16 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-md py-16 text-center">
        <Card>
          <CardHeader>
            <CardTitle>No access</CardTitle>
            <CardDescription>
              The activity log is available to owners and managers only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.push("/vendor")}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-gradient-to-r from-primary to-blue-700 text-primary-foreground shadow-sm">
        <div className="container mx-auto flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <History className="h-6 w-6" />
            <div>
              <h1 className="text-2xl font-bold">Activity Log</h1>
              <p className="text-sm text-primary-foreground/80">
                Every change made in your workspace.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-white/40 bg-white/10 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground"
            onClick={() => router.push("/vendor")}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </header>

      <div className="container mx-auto max-w-6xl space-y-6 py-8">
        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Action</label>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                >
                  {ACTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">From</label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">To</label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Search</label>
                <Input
                  type="search"
                  placeholder="Summary or actor…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Activity
              </CardTitle>
              <CardDescription>
                {count.toLocaleString()} event{count === 1 ? "" : "s"} recorded.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-10 w-full animate-pulse rounded bg-slate-100"
                  />
                ))}
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <History className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-600">
                  No activity found
                </p>
                <p className="text-xs text-muted-foreground">
                  {search || actionFilter || fromDate || toDate
                    ? "Try adjusting your filters."
                    : "Activity will appear here as your team makes changes."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b">
                      <th className="px-4 py-2 text-left font-semibold">When</th>
                      <th className="px-4 py-2 text-left font-semibold">Actor</th>
                      <th className="px-4 py-2 text-left font-semibold">Action</th>
                      <th className="px-4 py-2 text-left font-semibold">Entity</th>
                      <th className="px-4 py-2 text-left font-semibold">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr key={r.id} className="border-t align-top">
                        <td
                          className="whitespace-nowrap px-4 py-2 text-muted-foreground"
                          title={r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                        >
                          {relativeTime(r.created_at)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-700">
                            {r.actor_name || r.actor_email || "—"}
                          </div>
                          {r.actor_name && r.actor_email ? (
                            <div className="text-xs text-muted-foreground">
                              {r.actor_email}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${actionChipClass(
                              r.action,
                            )}`}
                          >
                            {r.action}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {r.entity_type ? (
                            <span>
                              {r.entity_type}
                              {r.entity_id ? (
                                <span
                                  className="ml-1 font-mono text-xs"
                                  title={r.entity_id}
                                >
                                  {shortId(r.entity_id)}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-700">
                          {r.summary || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {count > PAGE_SIZE ? (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 0 || loading}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
