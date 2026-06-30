"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import * as XLSX from "xlsx";
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
  Download,
  Loader2,
  Clock,
  LogOut,
  Hourglass,
  ShieldAlert,
  DollarSign,
  Users,
  CalendarRange,
  Package,
  Boxes,
  FlaskConical,
  TrendingUp,
  Receipt,
  Wallet,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";

type VendorInfo = {
  id: string;
  display_name: string;
  slug: string | null;
  status: "pending" | "approved" | "rejected" | "disabled";
  role: "owner" | "manager" | "staff" | null;
  rejected_reason?: string | null;
  email?: string | null;
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
    email: v.email ?? null,
  } as VendorInfo;
}

// Current financial year (Apr 1 – Mar 31) as the default range.
function currentFy() {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

const num = (v: unknown) => Number(v) || 0;

async function fetchJson(path: string): Promise<any | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---- Report definitions ----
// Each report knows how to fetch its data and turn it into rows (aoa). The
// `build` fn returns null/[] when there's nothing to export so callers can toast.
type ReportSheet = { name: string; aoa: (string | number)[][] };
type ReportDef = {
  key: string;
  title: string;
  description: string;
  icon: typeof Download;
  dated: boolean; // uses the from/to range
  ownerOnly?: boolean;
  // Returns one-or-more sheets, or null when there's no data.
  build: (range: { from: string; to: string }) => Promise<ReportSheet[] | null>;
};

const REPORTS: ReportDef[] = [
  {
    key: "sales-summary",
    title: "Sales Summary",
    description:
      "One-row KPIs: invoices, companies, billed, collected, outstanding and paid/partial/unpaid counts.",
    icon: TrendingUp,
    dated: true,
    build: async ({ from, to }) => {
      const d = await fetchJson(
        `/api/vendor/reports/dashboard-summary?from=${from}&to=${to}`,
      );
      if (!d) return null;
      const aoa: (string | number)[][] = [
        [
          "Invoices",
          "Companies",
          "Total Billed",
          "Total Collected",
          "Outstanding",
          "Paid",
          "Partial",
          "Unpaid",
        ],
        [
          num(d.invoice_count),
          num(d.company_count),
          num(d.total_billed),
          num(d.total_paid),
          num(d.total_outstanding),
          num(d.paid_count),
          num(d.partial_count),
          num(d.unpaid_count),
        ],
      ];
      return [{ name: "Sales Summary", aoa }];
    },
  },
  {
    key: "outstanding-by-customer",
    title: "Outstanding by Customer",
    description:
      "Billed, collected and pending per customer for the selected range, with a TOTAL row.",
    icon: Users,
    dated: true,
    build: async ({ from, to }) => {
      const rows = await fetchJson(
        `/api/vendor/reports/outstanding-by-customer?from=${from}&to=${to}`,
      );
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const aoa: (string | number)[][] = [
        ["Customer", "Phone", "Invoices", "Billed", "Collected", "Outstanding"],
      ];
      for (const r of rows) {
        aoa.push([
          r.customer_name ?? "",
          r.phone ?? "",
          num(r.invoice_count),
          num(r.billed),
          num(r.paid),
          num(r.outstanding),
        ]);
      }
      aoa.push([
        "TOTAL",
        "",
        rows.reduce((a: number, r: any) => a + num(r.invoice_count), 0),
        rows.reduce((a: number, r: any) => a + num(r.billed), 0),
        rows.reduce((a: number, r: any) => a + num(r.paid), 0),
        rows.reduce((a: number, r: any) => a + num(r.outstanding), 0),
      ]);
      return [{ name: "Outstanding", aoa }];
    },
  },
  {
    key: "sales-by-month",
    title: "Monthly Sales",
    description:
      "Billed vs collected grouped by month across the selected range, with a TOTAL row.",
    icon: CalendarRange,
    dated: true,
    build: async ({ from, to }) => {
      const rows = await fetchJson(
        `/api/vendor/reports/sales-by-month?from=${from}&to=${to}`,
      );
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const aoa: (string | number)[][] = [["Month", "Billed", "Collected"]];
      for (const r of rows) {
        aoa.push([
          String(r.month ?? "").slice(0, 7),
          num(r.billed),
          num(r.paid),
        ]);
      }
      aoa.push([
        "TOTAL",
        rows.reduce((a: number, r: any) => a + num(r.billed), 0),
        rows.reduce((a: number, r: any) => a + num(r.paid), 0),
      ]);
      return [{ name: "Monthly Sales", aoa }];
    },
  },
  {
    key: "top-products",
    title: "Top Products",
    description:
      "Best-selling invoice line items by sold value for the range (up to 100), with a TOTAL row.",
    icon: Package,
    dated: true,
    build: async ({ from, to }) => {
      const rows = await fetchJson(
        `/api/vendor/reports/top-products?from=${from}&to=${to}&limit=100`,
      );
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const aoa: (string | number)[][] = [["Product", "Qty", "Sold Value"]];
      for (const r of rows) {
        aoa.push([r.description ?? "", num(r.qty), num(r.sold_value)]);
      }
      aoa.push([
        "TOTAL",
        rows.reduce((a: number, r: any) => a + num(r.qty), 0),
        rows.reduce((a: number, r: any) => a + num(r.sold_value), 0),
      ]);
      return [{ name: "Top Products", aoa }];
    },
  },
  {
    key: "brand-stock-summary",
    title: "Brand Stock & Value",
    description:
      "Per-brand unit counts and stock / demo / sold valuation across all inventory (not date-ranged).",
    icon: Boxes,
    dated: false,
    build: async () => {
      const rows = await fetchJson(`/api/vendor/reports/brand-stock-summary`);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const aoa: (string | number)[][] = [
        [
          "Brand",
          "Products",
          "Total Units",
          "In Stock",
          "Sold",
          "Demo",
          "Expired",
          "Stock Value (cost)",
          "Demo Value (cost)",
          "Sold Value (invoiced)",
        ],
      ];
      for (const r of rows) {
        aoa.push([
          r.brand_name ?? "",
          num(r.product_count),
          num(r.total_units),
          num(r.in_stock),
          num(r.sold),
          num(r.demo),
          num(r.expired),
          num(r.in_stock_value),
          num(r.demo_value),
          num(r.sold_value),
        ]);
      }
      aoa.push([
        "TOTAL",
        rows.reduce((a: number, r: any) => a + num(r.product_count), 0),
        rows.reduce((a: number, r: any) => a + num(r.total_units), 0),
        rows.reduce((a: number, r: any) => a + num(r.in_stock), 0),
        rows.reduce((a: number, r: any) => a + num(r.sold), 0),
        rows.reduce((a: number, r: any) => a + num(r.demo), 0),
        rows.reduce((a: number, r: any) => a + num(r.expired), 0),
        rows.reduce((a: number, r: any) => a + num(r.in_stock_value), 0),
        rows.reduce((a: number, r: any) => a + num(r.demo_value), 0),
        rows.reduce((a: number, r: any) => a + num(r.sold_value), 0),
      ]);
      return [{ name: "Brand Stock", aoa }];
    },
  },
  {
    key: "demo-summary",
    title: "Demo Stock",
    description:
      "Per-product demo unit counts and cost value across all inventory (not date-ranged), with a TOTAL row.",
    icon: FlaskConical,
    dated: false,
    build: async () => {
      const rows = await fetchJson(`/api/vendor/reports/demo-summary`);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const aoa: (string | number)[][] = [
        ["Product", "Brand", "Demo Units", "Value (cost)"],
      ];
      for (const r of rows) {
        aoa.push([
          r.product_name ?? "",
          r.brand_name ?? "",
          num(r.demo_count),
          num(r.demo_value),
        ]);
      }
      aoa.push([
        "TOTAL",
        "",
        rows.reduce((a: number, r: any) => a + num(r.demo_count), 0),
        rows.reduce((a: number, r: any) => a + num(r.demo_value), 0),
      ]);
      return [{ name: "Demo Stock", aoa }];
    },
  },
  {
    key: "tax-summary",
    title: "GST / Tax Summary",
    description:
      "CGST / SGST / IGST and total tax over invoices in the range, plus a per-tax-type breakdown.",
    icon: Receipt,
    dated: true,
    build: async ({ from, to }) => {
      const d = await fetchJson(
        `/api/vendor/reports/tax-summary?from=${from}&to=${to}`,
      );
      const totals = d?.totals;
      if (!totals || num(totals.invoice_count) === 0) return null;

      const summaryAoa: (string | number)[][] = [
        [
          "Invoices",
          "Subtotal",
          "CGST",
          "SGST",
          "IGST",
          "Total Tax",
          "Grand Total",
        ],
        [
          num(totals.invoice_count),
          num(totals.subtotal),
          num(totals.cgst_amount),
          num(totals.sgst_amount),
          num(totals.igst_amount),
          num(totals.tax_amount),
          num(totals.grand_total),
        ],
      ];

      const byType = Array.isArray(d?.by_tax_type) ? d.by_tax_type : [];
      const byTypeAoa: (string | number)[][] = [
        [
          "Tax Type",
          "Invoices",
          "Subtotal",
          "CGST",
          "SGST",
          "IGST",
          "Total Tax",
          "Grand Total",
        ],
      ];
      for (const r of byType) {
        byTypeAoa.push([
          r.tax_type ?? "",
          num(r.invoice_count),
          num(r.subtotal),
          num(r.cgst_amount),
          num(r.sgst_amount),
          num(r.igst_amount),
          num(r.tax_amount),
          num(r.grand_total),
        ]);
      }
      byTypeAoa.push([
        "TOTAL",
        num(totals.invoice_count),
        num(totals.subtotal),
        num(totals.cgst_amount),
        num(totals.sgst_amount),
        num(totals.igst_amount),
        num(totals.tax_amount),
        num(totals.grand_total),
      ]);

      return [
        { name: "Tax Summary", aoa: summaryAoa },
        { name: "By Tax Type", aoa: byTypeAoa },
      ];
    },
  },
  {
    key: "payouts",
    title: "Payouts Statement",
    description:
      "Per-order earnings ledger (gross, commission, net) for your products on paid orders, with a TOTAL row.",
    icon: Wallet,
    dated: true,
    build: async ({ from, to }) => {
      const d = await fetchJson(
        `/api/vendor/payouts?from=${from}&to=${to}`,
      );
      const ledger = Array.isArray(d?.ledger) ? d.ledger : [];
      if (ledger.length === 0) return null;
      const aoa: (string | number)[][] = [
        ["Order #", "Paid At", "Customer", "Gross", "Commission", "Net"],
      ];
      for (const r of ledger) {
        aoa.push([
          r.order_number ?? r.order_id ?? "",
          r.paid_at ? String(r.paid_at).slice(0, 10) : "",
          r.customer_name ?? "",
          num(r.gross),
          num(r.commission),
          num(r.net),
        ]);
      }
      aoa.push([
        "TOTAL",
        "",
        "",
        ledger.reduce((a: number, r: any) => a + num(r.gross), 0),
        ledger.reduce((a: number, r: any) => a + num(r.commission), 0),
        ledger.reduce((a: number, r: any) => a + num(r.net), 0),
      ]);
      return [{ name: "Payouts", aoa }];
    },
  },
  {
    key: "profit-summary",
    title: "Profit & Loss",
    description:
      "Revenue (invoiced + online) minus cost of goods sold = gross profit, with units sold. Owner only.",
    icon: DollarSign,
    dated: true,
    ownerOnly: true,
    build: async ({ from, to }) => {
      const d = await fetchJson(
        `/api/vendor/reports/profit-summary?from=${from}&to=${to}`,
      );
      if (!d) return null;
      const aoa: (string | number)[][] = [
        ["Metric", "Amount"],
        ["Revenue (total)", num(d.revenue)],
        ["Invoice Revenue", num(d.invoice_revenue)],
        ["Online Revenue", num(d.online_revenue)],
        ["Cost of Goods Sold", num(d.cogs)],
        ["Gross Profit", num(d.gross_profit)],
        ["Units Sold", num(d.units_sold)],
      ];
      return [{ name: "Profit & Loss", aoa }];
    },
  },
];

export default function VendorReportsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);

  const fy = useMemo(() => currentFy(), []);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);

  // Per-report busy flag + an "all" busy flag.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [allBusy, setAllBusy] = useState(false);

  // ---- Gate (mirrors the dashboard) ----
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
      setVendor(coerceVendor(data));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, status]);

  const visibleReports = useMemo(
    () => REPORTS.filter((r) => !r.ownerOnly || vendor?.role === "owner"),
    [vendor?.role],
  );

  const safeName = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");

  const downloadOne = async (def: ReportDef) => {
    if (def.dated && (!from || !to)) {
      toast.error("Pick a from and to date first.");
      return;
    }
    setBusy((b) => ({ ...b, [def.key]: true }));
    try {
      const sheets = await def.build({ from, to });
      if (!sheets || sheets.length === 0) {
        toast.error(`No data to export for ${def.title}.`);
        return;
      }
      const wb = XLSX.utils.book_new();
      for (const s of sheets) {
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet(s.aoa),
          s.name.slice(0, 31),
        );
      }
      const suffix = def.dated ? `_${from}_to_${to}` : "";
      XLSX.writeFile(wb, `${safeName(def.title)}${suffix}.xlsx`);
      toast.success(`${def.title} downloaded.`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || `Failed to export ${def.title}.`);
    } finally {
      setBusy((b) => ({ ...b, [def.key]: false }));
    }
  };

  // Bonus: one workbook, one sheet per report (skips empty reports).
  const downloadAll = async () => {
    if (!from || !to) {
      toast.error("Pick a from and to date first.");
      return;
    }
    setAllBusy(true);
    try {
      const wb = XLSX.utils.book_new();
      const used = new Set<string>();
      let count = 0;
      for (const def of visibleReports) {
        let sheets: ReportSheet[] | null = null;
        try {
          sheets = await def.build({ from, to });
        } catch (e) {
          console.error(`build ${def.key} failed`, e);
        }
        if (!sheets) continue;
        for (const s of sheets) {
          // Ensure unique, <=31-char sheet names.
          let name = s.name.slice(0, 31);
          let n = 2;
          while (used.has(name)) {
            const base = s.name.slice(0, 28);
            name = `${base} ${n++}`;
          }
          used.add(name);
          XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.aoa_to_sheet(s.aoa),
            name,
          );
          count++;
        }
      }
      if (count === 0) {
        toast.error("No data to export in this range.");
        return;
      }
      XLSX.writeFile(wb, `vendor_reports_${from}_to_${to}.xlsx`);
      toast.success("All reports downloaded.");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to export reports.");
    } finally {
      setAllBusy(false);
    }
  };

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
        Loading reports…
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
            <div className="text-center text-xs text-muted-foreground">
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
            <Hourglass className="mx-auto mb-2 h-10 w-10 text-amber-500" />
            <CardTitle className="text-2xl">Application in Review</CardTitle>
            <CardDescription>
              Thanks, <b>{vendor.display_name}</b>. We’ll notify you once
              approved.
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

  if (vendor.status === "rejected" || vendor.status === "disabled") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardHeader>
            <ShieldAlert className="mx-auto mb-2 h-10 w-10 text-red-500" />
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
          <CardContent>
            <Button variant="outline" onClick={() => router.push("/vendor")}>
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
            <h1 className="text-2xl font-bold">Reports</h1>
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold capitalize">
              {vendor.status}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-primary-foreground/80">
              {vendor.display_name}
              {vendor.email || session?.user?.email ? (
                <> · {vendor.email ?? session?.user?.email}</>
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

      <div className="container mx-auto space-y-6 py-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-bold">Exports Hub</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Download any report as an XLSX file. Dated reports use the range
              below; stock reports cover all inventory.
            </p>
          </div>
          <Button variant="ghost" onClick={() => router.push("/vendor")}>
            ← Back to Dashboard
          </Button>
        </div>

        {/* Shared date range */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  From
                </label>
                <Input
                  type="date"
                  className="w-40"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  To
                </label>
                <Input
                  type="date"
                  className="w-40"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFrom(fy.from);
                  setTo(fy.to);
                }}
              >
                Current FY
              </Button>
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                <Clock className="h-3.5 w-3.5" />
                {from} → {to}
              </span>
            </div>
            <Button onClick={downloadAll} disabled={allBusy}>
              {allBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-2 h-4 w-4" />
              )}
              Download all (one workbook)
            </Button>
          </CardContent>
        </Card>

        {/* Report cards */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visibleReports.map((def) => {
            const Icon = def.icon;
            const isBusy = !!busy[def.key];
            return (
              <Card
                key={def.key}
                className="flex flex-col transition-shadow hover:shadow-lg"
              >
                <CardHeader>
                  <Icon className="mb-2 h-8 w-8 text-primary" />
                  <CardTitle className="flex items-center gap-2">
                    {def.title}
                    {def.ownerOnly && (
                      <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-medium uppercase text-white">
                        Owner
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>{def.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto space-y-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                    {def.dated ? (
                      <>
                        <CalendarRange className="h-3 w-3" />
                        {from} → {to}
                      </>
                    ) : (
                      <>
                        <Boxes className="h-3 w-3" />
                        All inventory
                      </>
                    )}
                  </span>
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={isBusy || allBusy}
                    onClick={() => downloadOne(def)}
                  >
                    {isBusy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Download XLSX
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
