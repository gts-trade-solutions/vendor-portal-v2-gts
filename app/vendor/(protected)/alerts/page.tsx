"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, ArrowLeft, ExternalLink, Package, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type VendorInfo = {
  id: string;
  display_name: string;
  status: "pending" | "approved" | "rejected" | "disabled";
};

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
};

type UnitStatus = "IN_STOCK" | "INVOICED" | "DEMO" | "SOLD" | "RETURNED" | "OUT_OF_STOCK";

type UnitRow = {
  id: string;
  product_id: string;
  unit_code: string;
  status: UnitStatus;
  // ✅ Use expiry_date to match your Units page
  expiry_date: string | null; // YYYY-MM-DD
};

type StockSummaryRow = {
  product_id: string;
  product_name: string;
  sku: string | null;

  total_units: number;
  in_stock: number;
  invoiced: number;
  demo: number;
  sold: number;
  returned: number;

  // expiry insights
  expired_units: number;
  expiring_soon_units: number;
  next_expiry_date: string | null; // earliest among IN_STOCK/INVOICED/DEMO
  next_expiry_days_left: number | null;

  // for sorting
  sort_key_days: number; // smaller = earlier expiry; big number = no expiry
};

function toYmd(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function daysLeftFromYmd(ymd?: string | null) {
  if (!ymd) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(ymd);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

function badgeForDaysLeft(daysLeft: number | null) {
  if (daysLeft == null) return <Badge variant="outline">No expiry</Badge>;
  if (daysLeft < 0) return <Badge variant="destructive">{Math.abs(daysLeft)}d expired</Badge>;
  if (daysLeft <= 30) return <Badge className="bg-red-500 text-white">{daysLeft}d left</Badge>;
  if (daysLeft <= 90) return <Badge className="bg-orange-500 text-white">{daysLeft}d left</Badge>;
  return <Badge variant="secondary">{daysLeft}d left</Badge>;
}

export default function VendorAlertsPage() {
  const router = useRouter();
  const { status } = useSession();

  const [hydrated, setHydrated] = useState(false);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [expiryAlertDays, setExpiryAlertDays] = useState<number>(180);
  const [lowStockThreshold] = useState<number>(5);

  const [rows, setRows] = useState<StockSummaryRow[]>([]);

  // 1) auth + vendor
  useEffect(() => {
    // NextAuth session gating: wait while loading, bounce to login when
    // unauthenticated, otherwise resolve the vendor via the cookie-auth endpoint.
    if (status === "loading") return;
    if (status === "unauthenticated") {
      setHydrated(true);
      router.replace("/vendor/login");
      return;
    }

    let cancelled = false;

    (async () => {
      setHydrated(true);

      let v: VendorInfo | undefined;
      let expiryDays = 180;
      try {
        const res = await fetch("/api/vendor/me", { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        const raw = body?.vendor;
        if (raw) {
          v = { id: raw.id, display_name: raw.display_name, status: raw.status } as VendorInfo;
          const days = Number(raw.expiry_alert_days ?? 180);
          expiryDays = Number.isFinite(days) && days > 0 ? days : 180;
        }
      } catch (error) {
        console.error("get_my_vendor error", error);
        router.replace("/vendor");
        return;
      }

      if (cancelled) return;

      if (!v) {
        router.replace("/vendor/register");
        return;
      }
      if (v.status !== "approved") {
        router.replace("/vendor");
        return;
      }

      setVendor(v);
      setExpiryAlertDays(expiryDays);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, status]);

  // 2) Load ALL stock summary and sort by expiry
  const load = async () => {
    if (!vendor?.id) return;

    setLoading(true);
    setErr(null);

    try {
      // products (vendor-scoped server endpoint)
      const pRes = await fetch("/api/vendor/products?mode=alerts", { cache: "no-store" });
      const pBody = await pRes.json();
      if (!pRes.ok || !pBody?.ok) throw new Error(pBody?.error || "Failed to load products");
      const products = pBody.data as any[];

      const productMap = new Map<string, ProductRow>();
      for (const p of (products ?? []) as any[]) {
        productMap.set(p.id, {
          id: p.id,
          name: p.name,
          sku: p.sku ?? null,
        });
      }

      // units (vendor-scoped server endpoint)
      const uRes = await fetch("/api/vendor/inventory-units?mode=alerts", { cache: "no-store" });
      const uBody = await uRes.json();
      if (!uRes.ok || !uBody?.ok) throw new Error(uBody?.error || "Failed to load units");
      const units = uBody.data as any[];

      const today = toYmd(new Date());

      // initialize summary for all products (even with 0 units)
      const summary = new Map<string, StockSummaryRow>();
      for (const p of productMap.values()) {
        summary.set(p.id, {
          product_id: p.id,
          product_name: p.name,
          sku: p.sku,

          total_units: 0,
          in_stock: 0,
          invoiced: 0,
          demo: 0,
          sold: 0,
          returned: 0,

          expired_units: 0,
          expiring_soon_units: 0,
          next_expiry_date: null,
          next_expiry_days_left: null,

          sort_key_days: 999999,
        });
      }

      // helper: consider expiry only for these statuses
      const expiryRelevant = (st: UnitStatus) =>
        st === "IN_STOCK" || st === "INVOICED" || st === "DEMO";

      for (const u of (units ?? []) as any as UnitRow[]) {
        const prod = summary.get(u.product_id);
        if (!prod) continue;

        prod.total_units += 1;

        if (u.status === "IN_STOCK") prod.in_stock += 1;
        else if (u.status === "INVOICED") prod.invoiced += 1;
        else if (u.status === "DEMO") prod.demo += 1;
        else if (u.status === "SOLD") prod.sold += 1;
        else if (u.status === "RETURNED") prod.returned += 1;

        const exp = u.expiry_date ? String(u.expiry_date).slice(0, 10) : null;
        if (!exp) continue;

        const dl = daysLeftFromYmd(exp);
        if (dl == null) continue;

        if (expiryRelevant(u.status)) {
          // expired + expiring soon counts
          if (exp < today) prod.expired_units += 1;
          else if (dl <= expiryAlertDays) prod.expiring_soon_units += 1;

          // next expiry = earliest exp date among expiry-relevant statuses
          if (!prod.next_expiry_date || exp < prod.next_expiry_date) {
            prod.next_expiry_date = exp;
            prod.next_expiry_days_left = dl;
          }
        }
      }

      // compute sort keys
      for (const prod of summary.values()) {
        if (prod.next_expiry_days_left != null) {
          prod.sort_key_days = prod.next_expiry_days_left;
        } else {
          // no expiry found => push down, but keep 0-stock and alerts visible by tabs
          prod.sort_key_days = 999999;
        }
      }

      // sort: earliest expiry first; tie-breaker by expired count desc; then name
      const out = Array.from(summary.values()).sort((a, b) => {
        if (a.sort_key_days !== b.sort_key_days) return a.sort_key_days - b.sort_key_days;
        if (a.expired_units !== b.expired_units) return b.expired_units - a.expired_units;
        return a.product_name.localeCompare(b.product_name);
      });

      setRows(out);
    } catch (e: any) {
      console.error(e);
      setRows([]);
      setErr(e?.message || "Failed to load stock summary");
      toast.error(e?.message || "Failed to load stock summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!vendor?.id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.id, expiryAlertDays]);

  const counts = useMemo(() => {
    const c = {
      all: rows.length,
      expired: 0,
      expiring: 0,
      low: 0,
      zero: 0,
    };
    for (const r of rows) {
      if (r.expired_units > 0) c.expired += 1;
      if (r.expiring_soon_units > 0) c.expiring += 1;
      if (r.in_stock > 0 && r.in_stock <= lowStockThreshold) c.low += 1;
      if (r.in_stock === 0) c.zero += 1;
    }
    return c;
  }, [rows, lowStockThreshold]);

  const filtered = useMemo(() => {
    const expired = rows.filter((r) => r.expired_units > 0);
    const expiring = rows.filter((r) => r.expiring_soon_units > 0 && r.expired_units === 0);
    const low = rows.filter((r) => r.in_stock > 0 && r.in_stock <= lowStockThreshold);
    const zero = rows.filter((r) => r.in_stock === 0);
    return { all: rows, expired, expiring, low, zero };
  }, [rows, lowStockThreshold]);

  const renderTable = (list: StockSummaryRow[]) => {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[260px]">Product</TableHead>
              <TableHead>SKU</TableHead>

              <TableHead className="text-right">In Stock</TableHead>
              <TableHead className="text-right">Invoiced</TableHead>
              <TableHead className="text-right">Demo</TableHead>
              <TableHead className="text-right">Sold</TableHead>
              <TableHead className="text-right">Returned</TableHead>
              <TableHead className="text-right">Total</TableHead>

              <TableHead>Next Expiry</TableHead>
              <TableHead>Expiry Status</TableHead>

              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                  No data
                </TableCell>
              </TableRow>
            ) : (
              list.map((r) => {
                const lowStock = r.in_stock > 0 && r.in_stock <= lowStockThreshold;

                return (
                  <TableRow key={r.product_id}>
                    <TableCell className="font-medium">
                      <div className="line-clamp-2">{r.product_name}</div>
                      <div className="text-xs text-muted-foreground">{r.product_id.slice(0, 8)}…</div>
                    </TableCell>

                    <TableCell className="text-sm">{r.sku ?? "—"}</TableCell>

                    <TableCell className="text-right">
                      <span className={lowStock ? "text-orange-600 font-semibold" : ""}>
                        {r.in_stock}
                      </span>
                      {lowStock ? (
                        <div className="text-xs text-orange-600">Low</div>
                      ) : null}
                    </TableCell>

                    <TableCell className="text-right">{r.invoiced}</TableCell>
                    <TableCell className="text-right">{r.demo}</TableCell>
                    <TableCell className="text-right">{r.sold}</TableCell>
                    <TableCell className="text-right">{r.returned}</TableCell>
                    <TableCell className="text-right">{r.total_units}</TableCell>

                    <TableCell className="text-sm">
                      {r.next_expiry_date ?? "—"}
                    </TableCell>

                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {badgeForDaysLeft(r.next_expiry_days_left)}
                        {r.expired_units > 0 ? (
                          <Badge variant="destructive" className="gap-2">
                            <ShieldAlert className="h-4 w-4" />
                            {r.expired_units} expired
                          </Badge>
                        ) : null}
                        {r.expiring_soon_units > 0 && r.expired_units === 0 ? (
                          <Badge variant="secondary">
                            {r.expiring_soon_units} expiring soon
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/vendor/products/${r.product_id}/units`)}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Units
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    );
  };

  if (!hydrated) return null;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/vendor")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">Stock & Expiry</h1>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Units-based Stock Summary (Sorted by Expiry)
            </CardTitle>
            <CardDescription>
              Stock is calculated from <b>inventory_units</b> only. Sorted by nearest expiry date.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {err ? <div className="text-sm text-destructive mb-3">{err}</div> : null}

            <div className="flex flex-wrap gap-3 mb-6">
              <Badge variant="outline">
                Expiry alert window: <b className="ml-1">{expiryAlertDays}</b> days
              </Badge>
              <Badge variant="outline">
                Low stock threshold: <b className="ml-1">{lowStockThreshold}</b>
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">All Products</div><div className="text-2xl font-bold">{loading ? "…" : counts.all}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Expired</div><div className="text-2xl font-bold">{loading ? "…" : counts.expired}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Expiring soon</div><div className="text-2xl font-bold">{loading ? "…" : counts.expiring}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Low stock</div><div className="text-2xl font-bold">{loading ? "…" : counts.low}</div></CardContent></Card>
              <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Zero stock</div><div className="text-2xl font-bold">{loading ? "…" : counts.zero}</div></CardContent></Card>
            </div>

            <Tabs defaultValue="all">
              <TabsList className="flex flex-wrap">
                <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                <TabsTrigger value="expired">Expired ({counts.expired})</TabsTrigger>
                <TabsTrigger value="expiring">Expiring ({counts.expiring})</TabsTrigger>
                <TabsTrigger value="low">Low Stock ({counts.low})</TabsTrigger>
                <TabsTrigger value="zero">Zero Stock ({counts.zero})</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(filtered.all)}
              </TabsContent>

              <TabsContent value="expired" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(filtered.expired)}
              </TabsContent>

              <TabsContent value="expiring" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(filtered.expiring)}
              </TabsContent>

              <TabsContent value="low" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(filtered.low)}
              </TabsContent>

              <TabsContent value="zero" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(filtered.zero)}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
