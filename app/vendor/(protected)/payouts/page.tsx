"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import * as XLSX from "xlsx";
import { useAuth } from "@/lib/contexts/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LogOut,
  Download,
  Wallet,
  TrendingUp,
  Percent,
  ShoppingCart,
  Inbox,
  Info,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

type VendorInfo = {
  id: string;
  display_name: string;
  slug: string | null;
  status: "pending" | "approved" | "rejected" | "disabled";
  role: "owner" | "manager" | "staff" | null;
  email?: string | null;
};

type LedgerRow = {
  order_id: string;
  order_number: string | null;
  paid_at: string | null;
  customer_name: string;
  gross: number;
  commission: number;
  net: number;
};

type Totals = {
  commission_rate: number;
  total_gross: number;
  total_commission: number;
  total_net: number;
  order_count: number;
};

type PayoutsResponse = {
  summary: Totals;
  window: (Totals & { from: string | null; to: string | null }) | null;
  ledger: LedgerRow[];
};

const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (v: unknown) => inr0.format(Number(v) || 0);
const money2 = (v: unknown) => inr2.format(Number(v) || 0);

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
    email: v.email ?? null,
  } as VendorInfo;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
}

const PER_PAGE = 10;
const stickyThead =
  "sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]";
const totalRowClass = "border-t bg-slate-100 font-semibold";

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-8 w-full animate-pulse rounded bg-slate-100"
          style={{ opacity: 1 - i * 0.08 }}
        />
      ))}
    </div>
  );
}

export default function VendorPayoutsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: session, status } = useSession();

  const [hydrated, setHydrated] = useState(false);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const [vendorEmail, setVendorEmail] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PayoutsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  // ---- Gate (NextAuth session + /api/vendor/me, like other pages) ----
  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      setHydrated(true);
      router.replace("/vendor/login");
      return;
    }
    let cancelled = false;
    (async () => {
      setHydrated(true);
      let v: VendorInfo | null = null;
      try {
        const res = await fetch("/api/vendor/me", { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          v = coerceVendor(j?.vendor ?? null);
        }
      } catch {
        /* fall through to null vendor */
      }
      if (cancelled) return;
      setVendor(v);
      if (v?.email) setVendorEmail(v.email);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, status]);

  const loadPayouts = async (range?: { from: string; to: string }) => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      const f = range?.from ?? from;
      const t = range?.to ?? to;
      if (f) params.set("from", f);
      if (t) params.set("to", t);
      const qs = params.toString();
      const res = await fetch(`/api/vendor/payouts${qs ? `?${qs}` : ""}`, {
        cache: "no-store",
      });
      const j = await res.json();
      if (!res.ok) {
        setData(null);
        setErr((j && j.error) || "Failed to load payouts");
      } else {
        setData(j as PayoutsResponse);
      }
    } catch (e: any) {
      setData(null);
      setErr(e?.message || "Failed to load payouts");
    }
    setLoading(false);
  };

  // Initial / vendor-ready load.
  useEffect(() => {
    if (!vendor?.id || vendor.status !== "approved") return;
    void loadPayouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.id, vendor?.status]);

  const summary = data?.summary ?? null;
  // Lifetime ledger is the source of truth; the window summary (if any) drives
  // a subtle "filtered" badge but the table itself respects the date filter.
  const allRows = useMemo(() => data?.ledger ?? [], [data]);

  const filteredRows = useMemo(() => {
    if (!from && !to) return allRows;
    return allRows.filter((r) => {
      const d = r.paid_at ? r.paid_at.slice(0, 10) : null;
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [allRows, from, to]);

  const filteredTotals = useMemo(
    () => ({
      gross: filteredRows.reduce((a, r) => a + Number(r.gross), 0),
      commission: filteredRows.reduce((a, r) => a + Number(r.commission), 0),
      net: filteredRows.reduce((a, r) => a + Number(r.net), 0),
    }),
    [filteredRows],
  );

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pagedRows = useMemo(
    () => filteredRows.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE),
    [filteredRows, safePage],
  );

  // Reset to page 1 whenever the filter changes the result set.
  useEffect(() => setPage(1), [from, to]);

  const applyFilter = () => {
    setPage(1);
    void loadPayouts();
  };
  const clearFilter = () => {
    setFrom("");
    setTo("");
    setPage(1);
    void loadPayouts({ from: "", to: "" });
  };

  const exportStatement = () => {
    if (filteredRows.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    const rows: Record<string, string | number>[] = filteredRows.map((r) => ({
      "Order #": r.order_number || r.order_id,
      Date: r.paid_at ? r.paid_at.slice(0, 10) : "",
      Customer: r.customer_name || "",
      Gross: Number(r.gross),
      Commission: Number(r.commission),
      Net: Number(r.net),
    }));
    rows.push({
      "Order #": "TOTAL",
      Date: "",
      Customer: "",
      Gross: filteredTotals.gross,
      Commission: filteredTotals.commission,
      Net: filteredTotals.net,
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payouts");
    const fLbl = from || "all";
    const tLbl = to || "all";
    XLSX.writeFile(wb, `payouts_${fLbl}_to_${tLbl}.xlsx`);
  };

  const handleLogout = async () => {
    try {
      await signOut({ callbackUrl: "/vendor/login" });
    } catch (e: any) {
      toast.error(e?.message || "Logout failed");
    }
  };

  if (!hydrated || (status === "authenticated" && !vendor && !err)) {
    return (
      <div className="container mx-auto py-16 text-muted-foreground">
        Loading payouts…
      </div>
    );
  }

  if (vendor && vendor.status !== "approved") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardHeader>
            <CardTitle>Payouts unavailable</CardTitle>
            <CardDescription>
              Your vendor account is <b>{vendor.status}</b>. Earnings appear once
              your account is approved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.push("/vendor")}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rate = summary?.commission_rate ?? 0;
  const filtering = Boolean(from || to);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-gradient-to-r from-primary to-blue-700 text-primary-foreground shadow-sm">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              className="border-white/40 bg-white/10 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground"
              onClick={() => router.push("/vendor")}
            >
              ← Back
            </Button>
            <h1 className="text-2xl font-bold">Payouts</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-primary-foreground/80">
              {vendor?.display_name}
              {vendorEmail || user?.email || session?.user?.email ? (
                <> · {vendorEmail ?? user?.email ?? session?.user?.email}</>
              ) : null}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="border-white/40 bg-white/10 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto py-8 space-y-6">
        {/* KPI cards (lifetime) */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                <Wallet className="h-3.5 w-3.5" />
                Total Net Earnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-700">
                {loading ? "…" : money(summary?.total_net)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Lifetime, after commission
              </p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500 bg-blue-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700">
                <TrendingUp className="h-3.5 w-3.5" />
                Gross Sales
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-900">
                {loading ? "…" : money(summary?.total_gross)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Your products, paid orders
              </p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-rose-500 bg-rose-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700">
                <Percent className="h-3.5 w-3.5" />
                Platform Commission
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-rose-700">
                {loading ? "…" : money(summary?.total_commission)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {rate}% of gross
              </p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-violet-500 bg-violet-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-700">
                <ShoppingCart className="h-3.5 w-3.5" />
                Paid Orders
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-violet-700">
                {loading ? "…" : (summary?.order_count ?? 0).toLocaleString()}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Orders with your products
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Computed-earnings note */}
        <div className="flex items-start gap-2 rounded-md border bg-blue-50/60 px-3 py-2 text-xs text-blue-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <span>
            Payouts are computed from your paid storefront orders. Net ={" "}
            gross minus the {rate}% platform commission. Disbursement scheduling
            and transfers are handled offline — this ledger is a statement of
            what you have earned, not a record of money already paid out.
          </span>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Earnings Ledger</CardTitle>
              <CardDescription>
                Per paid order, newest first.
                {filtering ? " Filtered by paid date." : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col">
                <label className="mb-0.5 text-[11px] font-medium text-muted-foreground">
                  From
                </label>
                <Input
                  type="date"
                  className="h-9 w-36"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="flex flex-col">
                <label className="mb-0.5 text-[11px] font-medium text-muted-foreground">
                  To
                </label>
                <Input
                  type="date"
                  className="h-9 w-36"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                className="h-9"
                onClick={applyFilter}
                disabled={loading}
              >
                Apply
              </Button>
              {filtering ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9"
                  onClick={clearFilter}
                  disabled={loading}
                >
                  Clear
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                onClick={exportStatement}
                disabled={loading || filteredRows.length === 0}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Export Statement
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {err ? (
              <div className="mb-3 text-sm text-destructive">{err}</div>
            ) : null}

            {loading ? (
              <TableSkeleton rows={8} />
            ) : filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {filtering
                    ? "No paid orders in this date range"
                    : "No paid orders yet"}
                </p>
              </div>
            ) : (
              <>
                <div className="max-h-[560px] overflow-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className={stickyThead}>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Order #</th>
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Customer</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Gross
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Commission
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Net
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          View
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRows.map((r) => (
                        <tr key={r.order_id} className="border-t">
                          <td className="px-3 py-2 font-medium">
                            <Link
                              href={`/vendor/orders/${r.order_id}`}
                              className="text-primary hover:underline"
                            >
                              {r.order_number || r.order_id.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{fmtDate(r.paid_at)}</td>
                          <td className="px-3 py-2">
                            {r.customer_name || (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {money2(r.gross)}
                          </td>
                          <td className="px-3 py-2 text-right text-rose-700">
                            −{money2(r.commission)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                            {money2(r.net)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7"
                              onClick={() =>
                                router.push(`/vendor/orders/${r.order_id}`)
                              }
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={totalRowClass}>
                        <td className="px-3 py-2" colSpan={3}>
                          TOTAL{filtering ? " (filtered)" : ""} ·{" "}
                          {filteredRows.length} orders
                        </td>
                        <td className="px-3 py-2 text-right">
                          {money2(filteredTotals.gross)}
                        </td>
                        <td className="px-3 py-2 text-right text-rose-700">
                          −{money2(filteredTotals.commission)}
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-700">
                          {money2(filteredTotals.net)}
                        </td>
                        <td className="px-3 py-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {pageCount > 1 ? (
                  <div className="flex items-center justify-between gap-2 pt-3 text-xs">
                    <span className="text-muted-foreground">
                      Showing {(safePage - 1) * PER_PAGE + 1}–
                      {Math.min(safePage * PER_PAGE, filteredRows.length)} of{" "}
                      {filteredRows.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Prev
                      </Button>
                      <span className="font-medium">
                        Page {safePage} of {pageCount}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={safePage >= pageCount}
                        onClick={() =>
                          setPage((p) => Math.min(pageCount, p + 1))
                        }
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
