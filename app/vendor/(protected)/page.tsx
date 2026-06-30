"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
  FileText,
  Package,
  ShoppingCart,
  DollarSign,
  AlertTriangle,
  LogOut,
  Hourglass,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  Users,
  Globe,
  CheckCircle2,
  Clock,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  FlaskConical,
  Search,
  Inbox,
  Boxes,
  Download,
  Settings,
  Building2,
  BarChart3,
  History,
  GitMerge,
} from "lucide-react";
import { toast } from "sonner";
import NotificationBell from "@/components/vendor/NotificationBell";

type VendorInfo = {
  id: string;
  display_name: string;
  slug: string | null;
  status: "pending" | "approved" | "rejected" | "disabled";
  role: "owner" | "manager" | "staff" | null;
  rejected_reason?: string | null;
  email?: string | null;
};

type ExpiringUnitRow = {
  unit_id: string;
  unit_code: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  expiry_date: string;
  days_left: number;
  status: "IN_STOCK" | "INVOICED" | "DEMO";
};

type ProductUnitAgg = {
  product_id: string;
  product_name: string;
  product_slug: string;
  in_stock: number;
  invoiced: number;
  demo: number;
  sold: number;
  returned: number;
  total: number;
  next_expiry_date: string | null;
  next_expiry_days_left: number | null;
};

type Summary = {
  invoice_count: number;
  company_count: number;
  total_billed: number;
  total_paid: number;
  total_outstanding: number;
  paid_count: number;
  partial_count: number;
  unpaid_count: number;
};
type CustomerRow = {
  customer_name: string;
  phone: string | null;
  invoice_count: number;
  billed: number;
  paid: number;
  outstanding: number;
};
type MonthRow = { month: string; billed: number; paid: number };
type BrandRow = {
  brand_id: string;
  brand_name: string;
  product_count: number;
  total_units: number;
  in_stock: number;
  sold: number;
  demo: number;
  expired: number;
  in_stock_value: number;
  sold_value: number;
  demo_value: number;
};
type Aging = {
  current: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
};
type TopProduct = { description: string; qty: number; sold_value: number };
type CustomerProduct = { description: string; qty: number; value: number };

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

// ---- Reusable pagination helpers (DRY across the big tables) ----
function paginate<T>(rows: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return rows.slice(start, start + perPage);
}

function usePagination(totalRows: number, deps: unknown[]) {
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(totalRows / perPage));
  // Reset to page 1 whenever inputs (search / period / per-page) change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), [perPage, ...deps]);
  // Clamp if the current page falls out of range after a data change.
  const safePage = Math.min(page, pageCount);
  return { page: safePage, setPage, perPage, setPerPage, pageCount };
}

function Pagination({
  page,
  pageCount,
  perPage,
  onPage,
  onPerPage,
}: {
  page: number;
  pageCount: number;
  perPage: number;
  onPage: (p: number) => void;
  onPerPage: (n: number) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t bg-slate-50/60 px-3 py-2 text-xs sm:flex-row">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>Rows</span>
        <select
          className="h-8 rounded-md border border-input bg-background px-2"
          value={perPage}
          onChange={(e) => onPerPage(Number(e.target.value))}
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
        >
          Prev
        </Button>
        <span className="font-medium text-foreground">
          Page {page} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page >= pageCount}
          onClick={() => onPage(Math.min(pageCount, page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// Consistent sticky table header for scroll/pagination containers.
const stickyThead = "sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]";
// Consistent TOTAL footer row styling.
const totalRowClass = "border-t bg-slate-100 font-semibold";

// Simple loading skeleton (animate-pulse bars) used inside cards.
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

// Clean empty state: muted icon + text.
function EmptyState({
  icon: Icon = Inbox,
  text,
}: {
  icon?: typeof Inbox;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

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
  } as VendorInfo;
}

function toYmd(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
function daysLeftFromYmd(ymd: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(ymd);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}
function expiryClass(daysLeft: number, alertDays: number) {
  if (daysLeft < 0) return "bg-red-600 text-white";
  if (daysLeft <= 30) return "bg-red-500 text-white";
  if (daysLeft <= 90) return "bg-orange-500 text-white";
  if (daysLeft <= alertDays) return "bg-yellow-400 text-black";
  return "bg-muted text-foreground";
}

type Mode = "fy" | "quarter" | "month" | "custom";
function fyRange(y: number) {
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}
function quarterRange(y: number, q: number) {
  const map: Record<number, [string, string]> = {
    1: [`${y}-04-01`, `${y}-06-30`],
    2: [`${y}-07-01`, `${y}-09-30`],
    3: [`${y}-10-01`, `${y}-12-31`],
    4: [`${y + 1}-01-01`, `${y + 1}-03-31`],
  };
  const [from, to] = map[q];
  return { from, to };
}
function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return { from: "", to: "" };
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
function monthLabel(d: string) {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

// The immediately-preceding window of equal length (for period comparison).
function prevPeriod(from: string, to: string) {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()))
    return { from: "", to: "" };
  const lenMs = t.getTime() - f.getTime();
  const prevTo = new Date(f.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - lenMs);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}

function pctChange(cur?: number, prev?: number) {
  const c = Number(cur || 0);
  const p = Number(prev || 0);
  if (p === 0) return null;
  return ((c - p) / p) * 100;
}

type BrandSortKey =
  | "brand_name"
  | "product_count"
  | "total_units"
  | "in_stock"
  | "sold"
  | "demo"
  | "expired"
  | "in_stock_value"
  | "sold_value";

export default function VendorDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: session, status } = useSession();

  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const [vendorEmail, setVendorEmail] = useState<string | null>(null);
  const [alertDays, setAlertDays] = useState<number>(180);

  const [unitStats, setUnitStats] = useState({
    productsWithUnits: 0,
    totalUnits: 0,
    inStockUnits: 0,
    lowStockProducts: 0,
    outOfStockProducts: 0,
    expiringUnits: 0,
    expiredUnits: 0,
  });
  const [expiringUnits, setExpiringUnits] = useState<ExpiringUnitRow[]>([]);

  // ---- Analytics period ----
  const now = new Date();
  const curFyStart =
    now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const curQuarter =
    now.getMonth() >= 3 && now.getMonth() <= 5
      ? 1
      : now.getMonth() >= 6 && now.getMonth() <= 8
        ? 2
        : now.getMonth() >= 9 && now.getMonth() <= 11
          ? 3
          : 4;
  const [mode, setMode] = useState<Mode>("fy");
  const [fyYear, setFyYear] = useState<number>(curFyStart);
  const [quarter, setQuarter] = useState<number>(curQuarter);
  const [monthStr, setMonthStr] = useState<string>(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [customFrom, setCustomFrom] = useState<string>(
    fyRange(curFyStart).from,
  );
  const [customTo, setCustomTo] = useState<string>(fyRange(curFyStart).to);

  const { from, to } = useMemo(() => {
    if (mode === "fy") return fyRange(fyYear);
    if (mode === "quarter") return quarterRange(fyYear, quarter);
    if (mode === "month") return monthRange(monthStr);
    return { from: customFrom, to: customTo };
  }, [mode, fyYear, quarter, monthStr, customFrom, customTo]);

  // ---- Analytics data ----
  const [summary, setSummary] = useState<Summary | null>(null);
  const [prevSummary, setPrevSummary] = useState<Summary | null>(null);
  const [byCustomer, setByCustomer] = useState<CustomerRow[]>([]);
  const [byMonth, setByMonth] = useState<MonthRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [aging, setAging] = useState<Aging | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [onlineSummary, setOnlineSummary] = useState<{
    order_count: number;
    paid_count: number;
    revenue: number;
  } | null>(null);
  const [demoRows, setDemoRows] = useState<
    {
      product_id: string;
      product_name: string;
      brand_name: string | null;
      demo_count: number;
      demo_value: number;
    }[]
  >([]);
  const [profit, setProfit] = useState<{
    revenue: number;
    invoice_revenue: number;
    online_revenue: number;
    cogs: number;
    units_sold: number;
    gross_profit: number;
  } | null>(null);
  const [aLoading, setALoading] = useState(false);

  // brand table controls
  const [brandSearch, setBrandSearch] = useState("");
  const [brandSort, setBrandSort] = useState<BrandSortKey>("in_stock");
  const [brandDir, setBrandDir] = useState<"asc" | "desc">("desc");

  // customer table controls + drill-down
  const [custSearch, setCustSearch] = useState("");
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [custInvoices, setCustInvoices] = useState<any[]>([]);
  const [custLoading, setCustLoading] = useState(false);
  // Drill-down view toggle + per-customer products cache (avoid refetch).
  const [drillView, setDrillView] = useState<"invoices" | "products">(
    "invoices",
  );
  const [custProductsCache, setCustProductsCache] = useState<
    Record<string, CustomerProduct[]>
  >({});
  const [custProductsLoading, setCustProductsLoading] = useState(false);

  // ---- Gate ----
  useEffect(() => {
    // NextAuth session gating: wait while loading, bounce to login when
    // unauthenticated, otherwise resolve the vendor via the server endpoint.
    if (status === "loading") return;
    if (status === "unauthenticated") {
      setHydrated(true);
      router.replace("/vendor/login");
      return;
    }

    let cancelled = false;
    (async () => {
      setHydrated(true);
      let data: any = null;
      try {
        const res = await fetch("/api/vendor/me", { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          data = j?.vendor ?? null;
        }
      } catch (error) {
        console.error("get_my_vendor error", error);
        if (cancelled) return;
        setVendor(null);
        setLoading(false);
        return;
      }
      if (cancelled) return;
      const v = coerceVendor(data);
      setVendor(v);
      if (v?.email) setVendorEmail(v.email);
      else if (v?.id) {
        // Vendor email fallback now comes from the server (Prisma, vendor-scoped)
        // instead of a direct browser supabase.from("vendors").select("email").
        try {
          const res = await fetch("/api/vendor/dashboard-data", {
            cache: "no-store",
          });
          if (res.ok) {
            const j = await res.json();
            setVendorEmail((j?.vendorEmail as string | null) ?? null);
          }
        } catch {
          /* non-fatal: header just omits the email */
        }
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, status]);

  // ---- Unit stats + expiry ----
  useEffect(() => {
    if (!vendor?.id || vendor.status !== "approved") return;
    (async () => {
      // Vendor settings + products + units now come from the server (Prisma,
      // scoped to ctx.vendor.id) instead of direct browser supabase reads.
      let payload: {
        expiryAlertDays: number;
        products: { id: string; name: string; slug: string }[];
        units: {
          id: string;
          product_id: string;
          unit_code: string;
          status: string;
          expiry_date: string | null;
        }[];
      } | null = null;
      try {
        const res = await fetch("/api/vendor/dashboard-data", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        payload = await res.json();
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || "Failed to load dashboard data");
        return;
      }

      const d = Number(payload?.expiryAlertDays ?? 180);
      const windowDays = Number.isFinite(d) && d > 0 ? d : 180;
      setAlertDays(windowDays);

      const todayYmd = toYmd(new Date());
      const endYmd = toYmd(new Date(Date.now() + windowDays * 86400000));

      const products = payload?.products ?? [];
      const productMap = new Map<string, { name: string; slug: string }>();
      for (const p of products as any[])
        productMap.set(p.id, { name: p.name, slug: p.slug });

      const units = payload?.units ?? [];

      const relevantExpiryStatus = new Set(["IN_STOCK", "INVOICED", "DEMO"]);
      const expList: ExpiringUnitRow[] = [];
      const agg = new Map<string, ProductUnitAgg>();

      for (const u of (units ?? []) as any[]) {
        const productId = String(u.product_id);
        const prod = productMap.get(productId);
        if (!prod) continue;
        if (!agg.has(productId)) {
          agg.set(productId, {
            product_id: productId,
            product_name: prod.name,
            product_slug: prod.slug,
            in_stock: 0,
            invoiced: 0,
            demo: 0,
            sold: 0,
            returned: 0,
            total: 0,
            next_expiry_date: null,
            next_expiry_days_left: null,
          });
        }
        const a = agg.get(productId)!;
        a.total += 1;
        const st = String(u.status || "IN_STOCK");
        if (st === "IN_STOCK") a.in_stock += 1;
        else if (st === "INVOICED") a.invoiced += 1;
        else if (st === "DEMO") a.demo += 1;
        else if (st === "SOLD") a.sold += 1;
        else if (st === "RETURNED") a.returned += 1;

        const exp = u.expiry_date ? String(u.expiry_date).slice(0, 10) : null;
        if (!exp) continue;
        const dl = daysLeftFromYmd(exp);
        if (relevantExpiryStatus.has(st)) {
          if (!a.next_expiry_date || exp < a.next_expiry_date) {
            a.next_expiry_date = exp;
            a.next_expiry_days_left = dl;
          }
          if (exp <= endYmd) {
            expList.push({
              unit_id: String(u.id),
              unit_code: String(u.unit_code),
              product_id: productId,
              product_name: prod.name,
              product_slug: prod.slug,
              expiry_date: exp,
              days_left: dl,
              status: st as any,
            });
          }
        }
      }

      expList.sort((a, b) => {
        const ax = a.days_left < 0 ? 0 : 1;
        const bx = b.days_left < 0 ? 0 : 1;
        if (ax !== bx) return ax - bx;
        return a.days_left - b.days_left;
      });
      setExpiringUnits(expList);

      let totalUnits = 0;
      let inStockUnits = 0;
      let expiredUnits = 0;
      let expiringUnitsCount = 0;
      const lowStockThreshold = 5;
      let lowStockProducts = 0;
      let outOfStockProducts = 0;

      for (const a of Array.from(agg.values())) {
        totalUnits += a.total;
        inStockUnits += a.in_stock;
        if (a.in_stock === 0) outOfStockProducts += 1;
        else if (a.in_stock > 0 && a.in_stock <= lowStockThreshold)
          lowStockProducts += 1;
      }
      for (const e of expList) {
        if (e.expiry_date < todayYmd) expiredUnits += 1;
        else expiringUnitsCount += 1;
      }

      setUnitStats({
        productsWithUnits: agg.size,
        totalUnits,
        inStockUnits,
        lowStockProducts,
        outOfStockProducts,
        expiringUnits: expiringUnitsCount,
        expiredUnits,
      });
    })();
  }, [vendor?.id, vendor?.status]);

  // ---- Analytics load (period-driven) ----
  useEffect(() => {
    if (!vendor?.id || vendor.status !== "approved" || !from || !to) return;
    let active = true;
    (async () => {
      setALoading(true);
      const prev = prevPeriod(from, to);
      // Report widgets are now read-only MySQL endpoints (Prisma) instead of
      // Supabase RPCs. Each returns the same RETURNS shape the page consumed via
      // `.data`, so we wrap the fetched JSON as `{ data }` to keep the rest of
      // this effect (and every downstream setter) unchanged.
      const reportFetch = async (path: string) => {
        try {
          const res = await fetch(path, { cache: "no-store" });
          if (!res.ok) return { data: null };
          return { data: await res.json() };
        } catch {
          return { data: null };
        }
      };
      const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const prevQs = `from=${encodeURIComponent(prev.from)}&to=${encodeURIComponent(prev.to)}`;
      const [s, c, m, b, ag, tp, ps, os, dm, pf] = await Promise.all([
        reportFetch(`/api/vendor/reports/dashboard-summary?${qs}`),
        reportFetch(`/api/vendor/reports/outstanding-by-customer?${qs}`),
        reportFetch(`/api/vendor/reports/sales-by-month?${qs}`),
        reportFetch(`/api/vendor/reports/brand-stock-summary`),
        reportFetch(`/api/vendor/reports/aging-buckets?${qs}`),
        reportFetch(`/api/vendor/reports/top-products?${qs}&limit=8`),
        reportFetch(`/api/vendor/reports/dashboard-summary?${prevQs}`),
        reportFetch(`/api/vendor/reports/online-sales-summary?${qs}`),
        reportFetch(`/api/vendor/reports/demo-summary`),
        reportFetch(`/api/vendor/reports/profit-summary?${qs}`),
      ]);
      if (!active) return;
      setSummary((s.data as Summary) || null);
      setPrevSummary((ps.data as Summary) || null);
      setOnlineSummary((os.data as any) || null);
      setByCustomer((c.data as CustomerRow[]) || []);
      setByMonth((m.data as MonthRow[]) || []);
      setBrands((b.data as BrandRow[]) || []);
      setAging((ag.data as Aging) || null);
      setTopProducts((tp.data as TopProduct[]) || []);
      setDemoRows((dm.data as typeof demoRows) || []);
      setProfit((pf.data as typeof profit) || null);
      setALoading(false);
    })();
    return () => {
      active = false;
    };
  }, [vendor?.id, vendor?.status, from, to]);

  // ---- Grouped expiry (by product + date) ----
  const groupedExpiry = useMemo(() => {
    const map = new Map<
      string,
      {
        product_id: string;
        product_name: string;
        expiry_date: string;
        days_left: number;
        count: number;
        statuses: Set<string>;
      }
    >();
    for (const u of expiringUnits) {
      const key = `${u.product_id}|${u.expiry_date}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.statuses.add(u.status);
      } else {
        map.set(key, {
          product_id: u.product_id,
          product_name: u.product_name,
          expiry_date: u.expiry_date,
          days_left: u.days_left,
          count: 1,
          statuses: new Set([u.status]),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const ax = a.days_left < 0 ? 0 : 1;
      const bx = b.days_left < 0 ? 0 : 1;
      if (ax !== bx) return ax - bx;
      return a.days_left - b.days_left;
    });
  }, [expiringUnits]);

  const sortedBrands = useMemo(() => {
    let rows = brands;
    const q = brandSearch.trim().toLowerCase();
    if (q) rows = rows.filter((b) => b.brand_name.toLowerCase().includes(q));
    const dir = brandDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av: any = (a as any)[brandSort];
      const bv: any = (b as any)[brandSort];
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (Number(av) - Number(bv)) * dir;
    });
  }, [brands, brandSearch, brandSort, brandDir]);

  const topCustomers = useMemo(
    () =>
      [...byCustomer]
        .sort((a, b) => Number(b.billed) - Number(a.billed))
        .slice(0, 6),
    [byCustomer],
  );

  // Customer search filter (name OR phone, case-insensitive).
  const filteredCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    if (!q) return byCustomer;
    return byCustomer.filter(
      (c) =>
        c.customer_name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q),
    );
  }, [byCustomer, custSearch]);

  // TOTAL footer across the FILTERED set (not just the current page).
  const customerTotals = useMemo(
    () => ({
      invoices: filteredCustomers.reduce(
        (a, r) => a + Number(r.invoice_count),
        0,
      ),
      billed: filteredCustomers.reduce((a, r) => a + Number(r.billed), 0),
      paid: filteredCustomers.reduce((a, r) => a + Number(r.paid), 0),
      outstanding: filteredCustomers.reduce(
        (a, r) => a + Number(r.outstanding),
        0,
      ),
    }),
    [filteredCustomers],
  );

  const brandTotals = useMemo(
    () => ({
      product_count: sortedBrands.reduce(
        (a, b) => a + Number(b.product_count),
        0,
      ),
      total_units: sortedBrands.reduce((a, b) => a + Number(b.total_units), 0),
      in_stock: sortedBrands.reduce((a, b) => a + Number(b.in_stock), 0),
      sold: sortedBrands.reduce((a, b) => a + Number(b.sold), 0),
      demo: sortedBrands.reduce((a, b) => a + Number(b.demo), 0),
      expired: sortedBrands.reduce((a, b) => a + Number(b.expired), 0),
      in_stock_value: sortedBrands.reduce(
        (a, b) => a + Number(b.in_stock_value),
        0,
      ),
      sold_value: sortedBrands.reduce((a, b) => a + Number(b.sold_value), 0),
    }),
    [sortedBrands],
  );

  const demoTotals = useMemo(
    () => ({
      demo_count: demoRows.reduce((a, d) => a + Number(d.demo_count), 0),
      demo_value: demoRows.reduce((a, d) => a + Number(d.demo_value), 0),
    }),
    [demoRows],
  );

  const topProductTotals = useMemo(
    () => ({
      qty: topProducts.reduce((a, p) => a + Number(p.qty), 0),
      sold_value: topProducts.reduce((a, p) => a + Number(p.sold_value), 0),
    }),
    [topProducts],
  );

  // Pagination state for the three big tables.
  const custPager = usePagination(filteredCustomers.length, [custSearch, from, to]);
  const brandPager = usePagination(sortedBrands.length, [
    brandSearch,
    brandSort,
    brandDir,
  ]);
  const demoPager = usePagination(demoRows.length, [from, to]);

  const pagedCustomers = useMemo(
    () => paginate(filteredCustomers, custPager.page, custPager.perPage),
    [filteredCustomers, custPager.page, custPager.perPage],
  );
  const pagedBrands = useMemo(
    () => paginate(sortedBrands, brandPager.page, brandPager.perPage),
    [sortedBrands, brandPager.page, brandPager.perPage],
  );
  const pagedDemo = useMemo(
    () => paginate(demoRows, demoPager.page, demoPager.perPage),
    [demoRows, demoPager.page, demoPager.perPage],
  );

  const sortBy = (key: BrandSortKey) => {
    if (brandSort === key) setBrandDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setBrandSort(key);
      setBrandDir(key === "brand_name" ? "asc" : "desc");
    }
  };

  const toggleCustomer = async (name: string) => {
    if (expandedCustomer === name) {
      setExpandedCustomer(null);
      return;
    }
    setExpandedCustomer(name);
    setDrillView("invoices");
    setCustLoading(true);
    // Drill-down invoice list now comes from the server (Prisma, vendor-scoped)
    // instead of a direct browser supabase.from("invoices").select(...).
    try {
      const params = new URLSearchParams({
        action: "customer-invoices",
        name,
        from,
        to,
      });
      const res = await fetch(`/api/vendor/dashboard-data?${params.toString()}`, {
        cache: "no-store",
      });
      const j = res.ok ? await res.json() : null;
      setCustInvoices(j?.invoices || []);
    } catch {
      setCustInvoices([]);
    }
    setCustLoading(false);
  };

  // Fetch (and cache) the products sold to one customer for the period.
  const fetchCustomerProducts = async (name: string) => {
    const cacheKey = `${name}|${from}|${to}`;
    if (custProductsCache[cacheKey]) return; // already cached
    setCustProductsLoading(true);
    try {
      const params = new URLSearchParams({
        action: "customer-products",
        name,
        from,
        to,
      });
      const res = await fetch(
        `/api/vendor/dashboard-data?${params.toString()}`,
        { cache: "no-store" },
      );
      const j = res.ok ? await res.json() : null;
      setCustProductsCache((prev) => ({
        ...prev,
        [cacheKey]: (j?.products as CustomerProduct[]) || [],
      }));
    } catch {
      setCustProductsCache((prev) => ({ ...prev, [cacheKey]: [] }));
    }
    setCustProductsLoading(false);
  };

  const showCustomerProducts = (name: string) => {
    setDrillView("products");
    void fetchCustomerProducts(name);
  };

  const exportOutstanding = () => {
    if (byCustomer.length === 0) {
      toast.error("Nothing to export for this period.");
      return;
    }
    const rows = byCustomer.map((r) => ({
      Customer: r.customer_name,
      Phone: r.phone || "",
      Invoices: Number(r.invoice_count),
      Billed: Number(r.billed),
      Collected: Number(r.paid),
      Outstanding: Number(r.outstanding),
    }));
    rows.push({
      Customer: "TOTAL",
      Phone: "",
      Invoices: byCustomer.reduce((a, r) => a + Number(r.invoice_count), 0),
      Billed: byCustomer.reduce((a, r) => a + Number(r.billed), 0),
      Collected: byCustomer.reduce((a, r) => a + Number(r.paid), 0),
      Outstanding: byCustomer.reduce((a, r) => a + Number(r.outstanding), 0),
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Outstanding");
    XLSX.writeFile(wb, `outstanding_${from}_to_${to}.xlsx`);
  };

  const exportBrands = () => {
    if (sortedBrands.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    const rows = sortedBrands.map((b) => ({
      Brand: b.brand_name,
      Products: b.product_count,
      "Total Units": b.total_units,
      "In Stock": b.in_stock,
      Sold: b.sold,
      Demo: b.demo,
      Expired: b.expired,
      "Stock Value (cost)": Number(b.in_stock_value),
      "Demo Value (cost)": Number(b.demo_value),
      "Sold Value (invoiced)": Number(b.sold_value),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Brands");
    XLSX.writeFile(wb, "brand_stock.xlsx");
  };

  const exportDemo = () => {
    if (demoRows.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    const rows: Record<string, string | number>[] = demoRows.map((d) => ({
      Product: d.product_name,
      Brand: d.brand_name || "",
      "Demo Units": Number(d.demo_count),
      "Value (cost)": Number(d.demo_value),
    }));
    rows.push({
      Product: "TOTAL",
      Brand: "",
      "Demo Units": demoTotals.demo_count,
      "Value (cost)": demoTotals.demo_value,
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Demo");
    XLSX.writeFile(wb, "demo_stock.xlsx");
  };

  const exportTopProducts = () => {
    if (topProducts.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    const rows: Record<string, string | number>[] = topProducts.map((p) => ({
      Product: p.description,
      Qty: Number(p.qty),
      "Sold Value": Number(p.sold_value),
    }));
    rows.push({
      Product: "TOTAL",
      Qty: topProductTotals.qty,
      "Sold Value": topProductTotals.sold_value,
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TopProducts");
    XLSX.writeFile(wb, `top_products_${from}_to_${to}.xlsx`);
  };

  const fyOptions = useMemo(() => {
    const arr: number[] = [];
    for (let y = curFyStart + 1; y >= curFyStart - 5; y--) arr.push(y);
    return arr;
  }, [curFyStart]);

  const handleLogout = async () => {
    try {
      await signOut({ callbackUrl: "/vendor/login" });
    } catch (e: any) {
      toast.error(e?.message || "Logout failed");
    }
  };

  if (!hydrated || loading) {
    return (
      <div className="container mx-auto py-16 text-muted-foreground">
        Loading vendor workspace…
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Become a Vendor</CardTitle>
            <CardDescription>
              Create a vendor account to access the portal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              className="w-full"
              onClick={() => router.push("/vendor/register")}
            >
              Create Vendor Account
            </Button>
            <div className="text-xs text-muted-foreground text-center">
              Already applied? Sign in via{" "}
              <Link href="/vendor/login" className="underline">
                Vendor Login
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (vendor.status === "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardHeader>
            <Hourglass className="h-10 w-10 mx-auto text-amber-500 mb-2" />
            <CardTitle className="text-2xl">Application in Review</CardTitle>
            <CardDescription>
              Thanks, <b>{vendor.display_name}</b>. We’ll notify you once
              approved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.push("/")}>
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (vendor.status === "rejected" || vendor.status === "disabled") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardHeader>
            <ShieldAlert className="h-10 w-10 mx-auto text-red-500 mb-2" />
            <CardTitle className="text-2xl">
              {vendor.status === "rejected"
                ? "Application Rejected"
                : "Account Disabled"}
            </CardTitle>
            <CardDescription>
              {vendor.rejected_reason
                ? `Reason: ${vendor.rejected_reason}`
                : "Please contact support."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" onClick={() => router.push("/")}>
              Back to Home
            </Button>
            <div className="text-xs text-muted-foreground">
              Need help? Email support@madeinkorea.in
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const maxBilled = Math.max(1, ...byMonth.map((r) => Number(r.billed) || 0));
  const agingTotal = aging
    ? aging.current + aging.d31_60 + aging.d61_90 + aging.d90_plus || 1
    : 1;

  const SortHead = ({ k, label }: { k: BrandSortKey; label: string }) => (
    <th
      className="cursor-pointer select-none px-3 py-2 text-right font-semibold hover:text-primary"
      onClick={() => sortBy(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          className={`h-3 w-3 ${brandSort === k ? "text-primary" : "text-muted-foreground/40"}`}
        />
      </span>
    </th>
  );

  const Delta = ({
    value,
    goodUp = true,
  }: {
    value: number | null;
    goodUp?: boolean;
  }) => {
    if (value === null || !Number.isFinite(value)) return null;
    const up = value >= 0;
    const good = goodUp ? up : !up;
    return (
      <span
        className={`font-medium ${good ? "text-green-600" : "text-red-600"}`}
      >
        {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
      </span>
    );
  };

  return (
    <div className="min-h-screen">
      <header className="border-b bg-gradient-to-r from-primary to-blue-700 text-primary-foreground shadow-sm">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Vendor Portal</h1>
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold capitalize">
              {vendor.status}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {vendor.status === "approved" && <NotificationBell />}
            <span className="text-sm text-primary-foreground/80">
              {vendor.display_name}
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
        {/* Title + period filter */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-bold">Dashboard</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                <Clock className="h-3.5 w-3.5" />
                {from} → {to}
              </span>
              {aLoading && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                  Loading…
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="fy">Financial Year</option>
              <option value="quarter">Quarter</option>
              <option value="month">Month</option>
              <option value="custom">Custom</option>
            </select>
            {(mode === "fy" || mode === "quarter") && (
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={fyYear}
                onChange={(e) => setFyYear(Number(e.target.value))}
              >
                {fyOptions.map((y) => (
                  <option key={y} value={y}>
                    FY {y}-{String((y + 1) % 100).padStart(2, "0")}
                  </option>
                ))}
              </select>
            )}
            {mode === "quarter" && (
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={quarter}
                onChange={(e) => setQuarter(Number(e.target.value))}
              >
                <option value={1}>Q1 (Apr–Jun)</option>
                <option value={2}>Q2 (Jul–Sep)</option>
                <option value={3}>Q3 (Oct–Dec)</option>
                <option value={4}>Q4 (Jan–Mar)</option>
              </select>
            )}
            {mode === "month" && (
              <Input
                type="month"
                className="w-40"
                value={monthStr}
                onChange={(e) => setMonthStr(e.target.value)}
              />
            )}
            {mode === "custom" && (
              <>
                <Input
                  type="date"
                  className="w-36"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
                <Input
                  type="date"
                  className="w-36"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </>
            )}
          </div>
        </div>

        {/* Financial summary cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
          <Card className="border-l-4 border-l-blue-500 bg-blue-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                Total Billed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-900">
                {money(summary?.total_billed)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary?.invoice_count ?? 0} invoices ·{" "}
                <Delta
                  value={pctChange(
                    summary?.total_billed,
                    prevSummary?.total_billed,
                  )}
                />{" "}
                vs prev
              </p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Collected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-700">
                {money(summary?.total_paid)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                <Delta
                  value={pctChange(
                    summary?.total_paid,
                    prevSummary?.total_paid,
                  )}
                />{" "}
                vs prev period
              </p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-rose-500 bg-rose-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                Outstanding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-rose-700">
                {money(summary?.total_outstanding)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                <Delta
                  value={pctChange(
                    summary?.total_outstanding,
                    prevSummary?.total_outstanding,
                  )}
                  goodUp={false}
                />{" "}
                vs prev period
              </p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-violet-500 bg-violet-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                Online Sales
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-violet-700">
                {money(onlineSummary?.revenue)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {onlineSummary?.paid_count ?? 0} paid orders (storefront)
              </p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-slate-400 bg-slate-50/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Avg Invoice
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {money(
                  summary && summary.invoice_count
                    ? summary.total_billed / summary.invoice_count
                    : 0,
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {byCustomer.length} customers
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Payment status — clear, separate cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/50">
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Paid
                </div>
                <div className="text-3xl font-bold text-emerald-700">
                  {summary?.paid_count ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  fully paid invoices
                </div>
              </div>
              <CheckCircle2 className="h-9 w-9 text-emerald-500/70" />
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-amber-500 bg-amber-50/50">
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Partial
                </div>
                <div className="text-3xl font-bold text-amber-600">
                  {summary?.partial_count ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  partly paid invoices
                </div>
              </div>
              <Clock className="h-9 w-9 text-amber-500/70" />
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-rose-500 bg-rose-50/50">
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                  Unpaid
                </div>
                <div className="text-3xl font-bold text-rose-700">
                  {summary?.unpaid_count ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  awaiting payment
                </div>
              </div>
              <AlertCircle className="h-9 w-9 text-rose-500/70" />
            </CardContent>
          </Card>
        </div>

        {/* Gross profit / loss — OWNER ONLY */}
        {vendor.role === "owner" && profit && (
          <Card
            className={`border-l-4 ${
              profit.gross_profit >= 0
                ? "border-l-emerald-500 bg-emerald-50/40"
                : "border-l-rose-500 bg-rose-50/40"
            }`}
          >
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Gross {profit.gross_profit >= 0 ? "Profit" : "Loss"}
                  <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium uppercase text-white">
                    Owner only
                  </span>
                </CardTitle>
                <CardDescription>
                  Sales revenue minus cost of goods sold (purchase price) for the
                  selected period.
                </CardDescription>
              </div>
              {profit.gross_profit >= 0 ? (
                <TrendingUp className="h-8 w-8 text-emerald-600" />
              ) : (
                <TrendingDown className="h-8 w-8 text-rose-600" />
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Gross {profit.gross_profit >= 0 ? "Profit" : "Loss"}
                  </div>
                  <div
                    className={`text-3xl font-bold ${
                      profit.gross_profit >= 0
                        ? "text-emerald-700"
                        : "text-rose-700"
                    }`}
                  >
                    {money(Math.abs(profit.gross_profit))}
                  </div>
                  {profit.revenue > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {((profit.gross_profit / profit.revenue) * 100).toFixed(1)}%
                      margin
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Revenue (sales)
                  </div>
                  <div className="text-xl font-semibold">
                    {money(profit.revenue)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Invoiced {money(profit.invoice_revenue)} · Online{" "}
                    {money(profit.online_revenue)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Cost of goods sold (COGS)
                  </div>
                  <div className="text-xl font-semibold">{money(profit.cogs)}</div>
                  <div className="text-xs text-muted-foreground">
                    purchase price of sold units
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Units sold</div>
                  <div className="text-xl font-semibold">{profit.units_sold}</div>
                  <div className="text-xs text-muted-foreground">in period</div>
                </div>
              </div>

              {/* Explicit subtraction: Revenue − COGS = Gross Profit */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-white/70 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Revenue</span>
                <span className="font-semibold">{money(profit.revenue)}</span>
                <span className="text-muted-foreground">−</span>
                <span className="text-muted-foreground">COGS</span>
                <span className="font-semibold">{money(profit.cogs)}</span>
                <span className="text-muted-foreground">=</span>
                <span className="text-muted-foreground">
                  Gross {profit.gross_profit >= 0 ? "Profit" : "Loss"}
                </span>
                <span
                  className={`font-bold ${
                    profit.gross_profit >= 0
                      ? "text-emerald-700"
                      : "text-rose-700"
                  }`}
                >
                  {money(profit.gross_profit)}
                </span>
                {profit.revenue > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({((profit.gross_profit / profit.revenue) * 100).toFixed(1)}%
                    margin)
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Charts: sales by month + AR aging */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Sales by Month</CardTitle>
              <CardDescription>Billed vs collected per month.</CardDescription>
            </CardHeader>
            <CardContent>
              {byMonth.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No data in range.
                </div>
              ) : (
                <div className="space-y-2">
                  {byMonth.map((r) => (
                    <div key={r.month} className="flex items-center gap-3">
                      <div className="w-16 shrink-0 text-xs text-muted-foreground">
                        {monthLabel(r.month)}
                      </div>
                      <div className="relative h-6 flex-1 overflow-hidden rounded bg-slate-100">
                        <div
                          className="absolute inset-y-0 left-0 rounded bg-blue-500/80"
                          style={{
                            width: `${(Number(r.billed) / maxBilled) * 100}%`,
                          }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 rounded bg-green-500/80"
                          style={{
                            width: `${(Number(r.paid) / maxBilled) * 100}%`,
                          }}
                        />
                      </div>
                      <div className="w-24 shrink-0 text-right text-xs font-medium">
                        {money(r.billed)}
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-3 rounded bg-blue-500/80" />{" "}
                      Billed
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-3 rounded bg-green-500/80" />{" "}
                      Collected
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Outstanding Aging</CardTitle>
              <CardDescription>By days past due.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(
                [
                  ["Current (≤30d)", aging?.current ?? 0, "bg-green-500"],
                  ["31–60 days", aging?.d31_60 ?? 0, "bg-amber-500"],
                  ["61–90 days", aging?.d61_90 ?? 0, "bg-orange-500"],
                  ["90+ days", aging?.d90_plus ?? 0, "bg-red-600"],
                ] as [string, number, string][]
              ).map(([label, val, color]) => (
                <div key={label}>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{money(val)}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded bg-slate-100">
                    <div
                      className={color}
                      style={{
                        width: `${(val / agingTotal) * 100}%`,
                        height: "100%",
                      }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Outstanding by Customer (with drill-down) */}
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Outstanding by Customer</CardTitle>
              <CardDescription>
                Billed, collected and pending per customer. Click a row for
                invoices or products.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search name or phone…"
                  className="pl-8 sm:w-60"
                  value={custSearch}
                  onChange={(e) => setCustSearch(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={exportOutstanding}>
                <Download className="mr-1.5 h-4 w-4" />
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {aLoading ? (
              <TableSkeleton rows={6} />
            ) : filteredCustomers.length === 0 ? (
              <EmptyState
                text={
                  custSearch
                    ? "No customers match your search."
                    : "No data in range."
                }
              />
            ) : (
              <div className="rounded-lg border">
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className={stickyThead}>
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left font-semibold">
                          Customer
                        </th>
                        <th className="px-4 py-2 text-left font-semibold">
                          Phone
                        </th>
                        <th className="px-4 py-2 text-right font-semibold">
                          Invoices
                        </th>
                        <th className="px-4 py-2 text-right font-semibold">
                          Billed
                        </th>
                        <th className="px-4 py-2 text-right font-semibold">
                          Collected
                        </th>
                        <th className="px-4 py-2 text-right font-semibold">
                          Outstanding
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedCustomers.map((r) => (
                        <Fragment key={r.customer_name}>
                          <tr
                            className="cursor-pointer border-t hover:bg-slate-50"
                            onClick={() => toggleCustomer(r.customer_name)}
                          >
                            <td className="px-4 py-2 font-medium">
                              <span className="inline-flex items-center gap-1">
                                {expandedCustomer === r.customer_name ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                                {r.customer_name}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {r.phone || "-"}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {r.invoice_count}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {money2(r.billed)}
                            </td>
                            <td className="px-4 py-2 text-right text-green-700">
                              {money2(r.paid)}
                            </td>
                            <td className="px-4 py-2 text-right font-medium text-red-700">
                              {money2(r.outstanding)}
                            </td>
                          </tr>
                          {expandedCustomer === r.customer_name && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={6} className="px-4 py-2">
                                {/* Invoices | Products toggle */}
                                <div className="mb-2 inline-flex overflow-hidden rounded-md border bg-background text-xs">
                                  <button
                                    className={`px-3 py-1 font-medium ${
                                      drillView === "invoices"
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-slate-100"
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDrillView("invoices");
                                    }}
                                  >
                                    Invoices
                                  </button>
                                  <button
                                    className={`px-3 py-1 font-medium ${
                                      drillView === "products"
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-slate-100"
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      showCustomerProducts(r.customer_name);
                                    }}
                                  >
                                    Products
                                  </button>
                                </div>

                                {drillView === "invoices" ? (
                                  custLoading ? (
                                    <div className="text-xs text-muted-foreground">
                                      Loading…
                                    </div>
                                  ) : custInvoices.length === 0 ? (
                                    <div className="text-xs text-muted-foreground">
                                      No invoices.
                                    </div>
                                  ) : (
                                    <div className="space-y-1">
                                      {custInvoices.map((inv) => {
                                        const g = Number(
                                          inv.grand_total ??
                                            inv.total_amount ??
                                            0,
                                        );
                                        const out = Math.max(
                                          g - Number(inv.amount_paid ?? 0),
                                          0,
                                        );
                                        return (
                                          <div
                                            key={inv.id}
                                            className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background px-3 py-1.5 text-xs"
                                          >
                                            <button
                                              className="font-medium text-primary hover:underline"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                router.push(
                                                  `/vendor/invoices/${inv.id}`,
                                                );
                                              }}
                                            >
                                              {inv.invoice_number}
                                            </button>
                                            <span className="text-muted-foreground">
                                              {inv.invoice_date}
                                            </span>
                                            <span>{money2(g)}</span>
                                            <span className="text-green-700">
                                              {money2(inv.amount_paid)}
                                            </span>
                                            <span className="font-medium text-red-700">
                                              {money2(out)}
                                            </span>
                                            <span
                                              className={`rounded px-2 py-0.5 ${
                                                inv.payment_status === "PAID"
                                                  ? "bg-green-100 text-green-700"
                                                  : inv.payment_status ===
                                                      "PARTIAL"
                                                    ? "bg-amber-100 text-amber-700"
                                                    : "bg-red-100 text-red-700"
                                              }`}
                                            >
                                              {inv.payment_status || "UNPAID"}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )
                                ) : (
                                  // Products view: which products were sold to this client.
                                  (() => {
                                    const key = `${r.customer_name}|${from}|${to}`;
                                    const prods = custProductsCache[key];
                                    if (custProductsLoading && !prods)
                                      return (
                                        <div className="text-xs text-muted-foreground">
                                          Loading…
                                        </div>
                                      );
                                    if (!prods || prods.length === 0)
                                      return (
                                        <div className="text-xs text-muted-foreground">
                                          No products.
                                        </div>
                                      );
                                    const pTotal = prods.reduce(
                                      (a, p) => ({
                                        qty: a.qty + Number(p.qty),
                                        value: a.value + Number(p.value),
                                      }),
                                      { qty: 0, value: 0 },
                                    );
                                    return (
                                      <div className="overflow-x-auto rounded border bg-background">
                                        <table className="w-full min-w-[360px] text-xs">
                                          <thead className="bg-slate-50">
                                            <tr className="border-b">
                                              <th className="px-3 py-1.5 text-left font-semibold">
                                                Product
                                              </th>
                                              <th className="px-3 py-1.5 text-right font-semibold">
                                                Qty
                                              </th>
                                              <th className="px-3 py-1.5 text-right font-semibold">
                                                Value
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {prods.map((p, i) => (
                                              <tr key={i} className="border-t">
                                                <td className="px-3 py-1.5">
                                                  {p.description || "—"}
                                                </td>
                                                <td className="px-3 py-1.5 text-right">
                                                  {Number(p.qty)}
                                                </td>
                                                <td className="px-3 py-1.5 text-right font-medium">
                                                  {money2(p.value)}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                          <tfoot>
                                            <tr className={totalRowClass}>
                                              <td className="px-3 py-1.5">
                                                TOTAL
                                              </td>
                                              <td className="px-3 py-1.5 text-right">
                                                {pTotal.qty}
                                              </td>
                                              <td className="px-3 py-1.5 text-right">
                                                {money2(pTotal.value)}
                                              </td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>
                                    );
                                  })()
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={totalRowClass}>
                        <td className="px-4 py-2" colSpan={2}>
                          TOTAL ({filteredCustomers.length} customers)
                        </td>
                        <td className="px-4 py-2 text-right">
                          {customerTotals.invoices}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {money2(customerTotals.billed)}
                        </td>
                        <td className="px-4 py-2 text-right text-green-700">
                          {money2(customerTotals.paid)}
                        </td>
                        <td className="px-4 py-2 text-right text-red-700">
                          {money2(customerTotals.outstanding)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <Pagination
                  page={custPager.page}
                  pageCount={custPager.pageCount}
                  perPage={custPager.perPage}
                  onPage={custPager.setPage}
                  onPerPage={custPager.setPerPage}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top products + top customers */}
        <div className="grid gap-6 lg:grid-cols-2">
          {topProducts.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Top Products</CardTitle>
                  <CardDescription>
                    By sold value in the period.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={exportTopProducts}>
                  <Download className="mr-1.5 h-4 w-4" />
                  Export
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead className="bg-slate-50">
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left font-semibold">
                          Product
                        </th>
                        <th className="px-4 py-2 text-right font-semibold">
                          Qty
                        </th>
                        <th className="px-4 py-2 text-right font-semibold">
                          Sold Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.map((p, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-4 py-2">{p.description}</td>
                          <td className="px-4 py-2 text-right">
                            {Number(p.qty)}
                          </td>
                          <td className="px-4 py-2 text-right font-medium">
                            {money2(p.sold_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={totalRowClass}>
                        <td className="px-4 py-2">TOTAL</td>
                        <td className="px-4 py-2 text-right">
                          {topProductTotals.qty}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {money2(topProductTotals.sold_value)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {topCustomers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top Customers</CardTitle>
                <CardDescription>
                  By billed value in the period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead className="bg-slate-50">
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left font-semibold">
                          Customer
                        </th>
                        <th className="px-4 py-2 text-right font-semibold">
                          Billed
                        </th>
                        <th className="px-4 py-2 text-right font-semibold">
                          Outstanding
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCustomers.map((cst) => (
                        <tr key={cst.customer_name} className="border-t">
                          <td className="px-4 py-2">{cst.customer_name}</td>
                          <td className="px-4 py-2 text-right font-medium">
                            {money2(cst.billed)}
                          </td>
                          <td className="px-4 py-2 text-right text-red-700">
                            {money2(cst.outstanding)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Brand-wise stock (filter + sort) */}
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Brand-wise Stock &amp; Value</CardTitle>
              <CardDescription>
                Click any column header to sort. Search to filter brands.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search brand…"
                className="sm:w-56"
                value={brandSearch}
                onChange={(e) => setBrandSearch(e.target.value)}
              />
              <Button variant="outline" size="sm" onClick={exportBrands}>
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {aLoading ? (
              <TableSkeleton rows={6} />
            ) : sortedBrands.length === 0 ? (
              <EmptyState
                icon={Boxes}
                text={
                  brandSearch ? "No brands match your search." : "No stock data."
                }
              />
            ) : (
              <div className="rounded-lg border">
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className={stickyThead}>
                      <tr className="border-b">
                        <th
                          className="cursor-pointer select-none px-3 py-2 text-left font-semibold hover:text-primary"
                          onClick={() => sortBy("brand_name")}
                        >
                          <span className="inline-flex items-center gap-1">
                            Brand
                            <ArrowUpDown
                              className={`h-3 w-3 ${
                                brandSort === "brand_name"
                                  ? "text-primary"
                                  : "text-muted-foreground/40"
                              }`}
                            />
                          </span>
                        </th>
                        <SortHead k="product_count" label="Products" />
                        <SortHead k="total_units" label="Total" />
                        <SortHead k="in_stock" label="In Stock" />
                        <SortHead k="sold" label="Sold" />
                        <SortHead k="demo" label="Demo" />
                        <SortHead k="expired" label="Expired" />
                        <SortHead
                          k="in_stock_value"
                          label="Stock Value (cost)"
                        />
                        <SortHead k="sold_value" label="Sold (Invoiced)" />
                      </tr>
                    </thead>
                    <tbody>
                      {pagedBrands.map((b) => (
                        <tr key={b.brand_id} className="border-t">
                          <td className="px-3 py-2">{b.brand_name}</td>
                          <td className="px-3 py-2 text-right">
                            {b.product_count}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {b.total_units}
                          </td>
                          <td className="px-3 py-2 text-right">{b.in_stock}</td>
                          <td className="px-3 py-2 text-right">{b.sold}</td>
                          <td className="px-3 py-2 text-right">{b.demo}</td>
                          <td className="px-3 py-2 text-right text-red-600">
                            {b.expired}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {money2(b.in_stock_value)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {money2(b.sold_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={totalRowClass}>
                        <td className="px-3 py-2">
                          TOTAL ({sortedBrands.length})
                        </td>
                        <td className="px-3 py-2 text-right">
                          {brandTotals.product_count}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {brandTotals.total_units}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {brandTotals.in_stock}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {brandTotals.sold}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {brandTotals.demo}
                        </td>
                        <td className="px-3 py-2 text-right text-red-600">
                          {brandTotals.expired}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {money2(brandTotals.in_stock_value)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {money2(brandTotals.sold_value)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <Pagination
                  page={brandPager.page}
                  pageCount={brandPager.pageCount}
                  perPage={brandPager.perPage}
                  onPage={brandPager.setPage}
                  onPerPage={brandPager.setPerPage}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Demo stock */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Demo Stock</CardTitle>
              <CardDescription>
                Units issued as demo and their cost value.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportDemo}>
                <Download className="mr-1.5 h-4 w-4" />
                Export
              </Button>
              <FlaskConical className="h-7 w-7 text-violet-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                <div className="text-xs text-muted-foreground">Demo Units</div>
                <div className="text-2xl font-bold text-violet-700">
                  {demoRows.reduce((s, d) => s + Number(d.demo_count), 0)}
                </div>
              </div>
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                <div className="text-xs text-muted-foreground">
                  Demo Value (cost)
                </div>
                <div className="text-2xl font-bold text-violet-700">
                  {money(demoRows.reduce((s, d) => s + Number(d.demo_value), 0))}
                </div>
              </div>
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                <div className="text-xs text-muted-foreground">
                  Products on Demo
                </div>
                <div className="text-2xl font-bold text-violet-700">
                  {demoRows.length}
                </div>
              </div>
            </div>
            {aLoading ? (
              <TableSkeleton rows={4} />
            ) : demoRows.length === 0 ? (
              <EmptyState icon={FlaskConical} text="No demo units issued." />
            ) : (
              <div className="rounded-lg border">
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className={stickyThead}>
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left font-semibold">
                          Product
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          Brand
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Demo Units
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Value (cost)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedDemo.map((d) => (
                        <tr key={d.product_id} className="border-t">
                          <td className="px-3 py-2">{d.product_name}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {d.brand_name || "-"}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {d.demo_count}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {money2(d.demo_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={totalRowClass}>
                        <td className="px-3 py-2" colSpan={2}>
                          TOTAL ({demoRows.length})
                        </td>
                        <td className="px-3 py-2 text-right">
                          {demoTotals.demo_count}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {money2(demoTotals.demo_value)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {demoRows.length > demoPager.perPage && (
                  <Pagination
                    page={demoPager.page}
                    pageCount={demoPager.pageCount}
                    perPage={demoPager.perPage}
                    onPage={demoPager.setPage}
                    onPerPage={demoPager.setPerPage}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Inventory / expiry stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Products (with Units)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {unitStats.productsWithUnits}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Total units: {unitStats.totalUnits}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Stock Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {unitStats.outOfStockProducts + unitStats.lowStockProducts}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Out: {unitStats.outOfStockProducts} • Low:{" "}
                {unitStats.lowStockProducts}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Expiring Units
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {unitStats.expiringUnits}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Within {alertDays} days
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Expired Units
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-700">
                {unitStats.expiredUnits}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Already expired
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Grouped expiry alerts */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Unit Expiry Alerts</CardTitle>
              <CardDescription>
                Grouped by product &amp; expiry date — within {alertDays} days
                (incl. expired).
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.push("/vendor/alerts")}
              >
                View All
              </Button>
              <Button
                size="sm"
                onClick={() => router.push("/vendor/alerts?tab=expired")}
              >
                Expired
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {groupedExpiry.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No units expiring within the alert window.
              </div>
            ) : (
              <>
                <div className="max-h-[360px] space-y-2 overflow-auto pr-2">
                  {groupedExpiry.slice(0, 15).map((g) => (
                    <div
                      key={`${g.product_id}|${g.expiry_date}`}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {g.product_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            {g.count} unit{g.count > 1 ? "s" : ""}
                          </span>{" "}
                          expiring on {g.expiry_date} •{" "}
                          {Array.from(g.statuses).join(", ")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-1 text-xs ${expiryClass(g.days_left, alertDays)}`}
                        >
                          {g.days_left < 0
                            ? `${Math.abs(g.days_left)}d expired`
                            : `${g.days_left}d left`}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            router.push(
                              `/vendor/products/${g.product_id}/units`,
                            )
                          }
                        >
                          Open Units
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Showing {Math.min(15, groupedExpiry.length)} of{" "}
                    {groupedExpiry.length} groups
                  </span>
                  <button
                    className="underline"
                    onClick={() => router.push("/vendor/alerts")}
                  >
                    View full list →
                  </button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <FileText className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Invoices</CardTitle>
              <CardDescription>Create and manage invoices</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/invoices")}
              >
                Open Invoices
              </Button>
            </CardContent>
          </Card>
          <Card className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <Package className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Products</CardTitle>
              <CardDescription>Manage your product catalog</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/products")}
              >
                Manage Products
              </Button>
            </CardContent>
          </Card>
          <Card className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <ShoppingCart className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Orders</CardTitle>
              <CardDescription>View and fulfill orders</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/orders")}
              >
                View Orders
              </Button>
            </CardContent>
          </Card>
          <Card className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <DollarSign className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Payouts</CardTitle>
              <CardDescription>Track your earnings</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/payouts")}
              >
                View Payouts
              </Button>
            </CardContent>
          </Card>
          <Card className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <AlertTriangle className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Alerts</CardTitle>
              <CardDescription>Monitor inventory and expiry</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/alerts")}
              >
                View Alerts
              </Button>
            </CardContent>
          </Card>

          <Card className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <Globe className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Online Sales</CardTitle>
              <CardDescription>
                Storefront orders &amp; fulfilment
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/online-orders")}
              >
                View Online Orders
              </Button>
            </CardContent>
          </Card>

          <Card className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <BarChart3 className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Reports</CardTitle>
              <CardDescription>Download XLSX exports</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/reports")}
              >
                Open Reports
              </Button>
            </CardContent>
          </Card>

          <Card className="transition-shadow hover:shadow-lg">
            <CardHeader>
              <Settings className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Settings</CardTitle>
              <CardDescription>Business profile &amp; account</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/settings")}
              >
                Open Settings
              </Button>
            </CardContent>
          </Card>

          {(vendor.role === "owner" || vendor.role === "manager") && (
            <Card className="transition-shadow hover:shadow-lg">
              <CardHeader>
                <Users className="mb-2 h-8 w-8 text-primary" />
                <CardTitle>Team</CardTitle>
                <CardDescription>Manage staff &amp; access</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => router.push("/vendor/team")}
                >
                  Manage Team
                </Button>
              </CardContent>
            </Card>
          )}

          {(vendor.role === "owner" || vendor.role === "manager") && (
            <Card className="transition-shadow hover:shadow-lg">
              <CardHeader>
                <Building2 className="mb-2 h-8 w-8 text-primary" />
                <CardTitle>Invoice Companies</CardTitle>
                <CardDescription>
                  Seller entities &amp; bank details
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => router.push("/vendor/invoice-companies")}
                >
                  Manage Companies
                </Button>
              </CardContent>
            </Card>
          )}

          {(vendor.role === "owner" || vendor.role === "manager") && (
            <Card className="transition-shadow hover:shadow-lg">
              <CardHeader>
                <History className="mb-2 h-8 w-8 text-primary" />
                <CardTitle>Activity Log</CardTitle>
                <CardDescription>Audit trail of changes</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => router.push("/vendor/activity")}
                >
                  View Activity
                </Button>
              </CardContent>
            </Card>
          )}

          {(vendor.role === "owner" || vendor.role === "manager") && (
            <Card className="transition-shadow hover:shadow-lg">
              <CardHeader>
                <GitMerge className="mb-2 h-8 w-8 text-primary" />
                <CardTitle>Merge Duplicates</CardTitle>
                <CardDescription>
                  Combine duplicate online + inventory products
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => router.push("/vendor/products/merge")}
                >
                  Merge Products
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
