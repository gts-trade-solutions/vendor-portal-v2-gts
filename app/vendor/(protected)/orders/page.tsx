"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  LogOut,
  Eye,
  RefreshCw,
  Download,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

type VendorOrderRow = {
  order_id: string;
  order_number: string;
  status: string;
  created_at: string;
  currency: string;
  vendor_total: number;
  item_qty: number;
  address_snapshot: any; // jsonb or stringified json; we'll parse safely
};

type SortKey = "created_at" | "vendor_total" | "status";
type SortDir = "asc" | "desc";

const STATUS_OPTIONS = [
  "paid",
  "pending",
  "processing",
  "shipped",
  "dispatched",
  "delivered",
  "cancelled",
  "refunded",
  "failed",
];

const PAGE_SIZES = [20, 50, 100];

function safeParseSnapshot(snap: any): any {
  if (!snap) return null;
  if (typeof snap === "object") return snap;
  if (typeof snap === "string") {
    try {
      return JSON.parse(snap);
    } catch {
      return null;
    }
  }
  return null;
}

function formatMoney(v: number | null | undefined, currency?: string | null) {
  if (v == null) return "";
  const code = (currency ?? "INR").toUpperCase();
  if (code === "INR") return `₹${Number(v).toLocaleString("en-IN")}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(Number(v));
  } catch {
    return `${code} ${Number(v).toLocaleString()}`;
  }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function statusVariant(status: string) {
  const s = (status || "").toLowerCase();
  if (["delivered"].includes(s)) return "default";
  if (["shipped", "dispatched"].includes(s)) return "secondary";
  if (["cancelled", "refunded", "failed"].includes(s)) return "destructive";
  return "outline";
}

function deriveCustomer(snapRaw: any) {
  const snap = safeParseSnapshot(snapRaw);
  return {
    customerName: snap?.name || snap?.full_name || snap?.customer_name || "",
    customerPhone: snap?.phone || "",
  };
}

export default function VendorOrdersPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<VendorOrderRow[]>([]);
  const [count, setCount] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // filters / sort / pagination
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortKey>("created_at");
  const [dir, setDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // any filter/sort change resets to page 1
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, from, to, sort, dir, pageSize]);

  const buildParams = useCallback(
    (opts?: { all?: boolean }) => {
      const params = new URLSearchParams();
      if (opts?.all) {
        params.set("all", "1");
      } else {
        params.set("limit", String(pageSize));
        params.set("offset", String((page - 1) * pageSize));
      }
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("sort", sort);
      params.set("dir", dir);
      return params.toString();
    },
    [pageSize, page, debouncedSearch, status, from, to, sort, dir]
  );

  // guard against out-of-order responses
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqId.current;
    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(`/api/vendor/orders?${buildParams()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (myReq !== reqId.current) return; // a newer request superseded us
      if (!res.ok) {
        console.error("vendor orders list error", data);
        setRows([]);
        setCount(0);
        setErr((data && data.error) || "Failed to load orders");
        setLoading(false);
        return;
      }
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      setRows(list as VendorOrderRow[]);
      setCount(Number(data?.count ?? list.length));
    } catch (e: any) {
      if (myReq !== reqId.current) return;
      console.error("vendor orders list error", e);
      setRows([]);
      setCount(0);
      setErr(e?.message || "Failed to load orders");
    }
    if (myReq === reqId.current) setLoading(false);
  }, [buildParams]);

  useEffect(() => {
    load();
    // VendorGate already ensures session + approved vendor
    // so we don’t re-check auth here.
  }, [load]);

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out successfully");
    router.push("/");
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      // sensible defaults: dates/totals desc, status asc
      setDir(key === "status" ? "asc" : "desc");
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sort !== key) return <ChevronsUpDown className="ml-1 inline h-3.5 w-3.5 opacity-50" />;
    return dir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3.5 w-3.5" />
    ) : (
      <ArrowDown className="ml-1 inline h-3.5 w-3.5" />
    );
  };

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatus("");
    setFrom("");
    setTo("");
    setSort("created_at");
    setDir("desc");
  };

  const hasActiveFilters = !!(debouncedSearch || status || from || to);

  const mapped = useMemo(() => {
    return rows.map((r) => ({ ...r, ...deriveCustomer(r.address_snapshot) }));
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const rangeStart = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, count);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/vendor/orders?${buildParams({ all: true })}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error((data && data.error) || "Export failed");
        return;
      }
      const list: VendorOrderRow[] = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
        ? data
        : [];
      if (list.length === 0) {
        toast.info("Nothing to export for the current filters");
        return;
      }
      const aoa = list.map((r) => {
        const { customerName, customerPhone } = deriveCustomer(r.address_snapshot);
        return {
          "Order#": r.order_number ?? "",
          Date: formatDate(r.created_at),
          Customer: customerName || "",
          Phone: customerPhone || "",
          Items: Number(r.item_qty ?? 0),
          "Vendor Total": Number(r.vendor_total ?? 0),
          Status: r.status ?? "",
        };
      });
      const ws = XLSX.utils.json_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Orders");
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `vendor-orders-${stamp}.xlsx`);
      toast.success(`Exported ${list.length} order${list.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      console.error("vendor orders export error", e);
      toast.error(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/vendor")}>
              ← Back
            </Button>
            <h1 className="text-2xl font-bold">Order Management</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Orders</CardTitle>
                <CardDescription>Orders that include your products</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting || loading}
              >
                <Download className="mr-2 h-4 w-4" />
                {exporting ? "Exporting…" : "Export"}
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {/* Filter bar */}
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="lg:col-span-2">
                <Input
                  placeholder="Search order # or customer…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>

              <Input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From date"
              />
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To date"
              />
            </div>

            {hasActiveFilters ? (
              <div className="mb-4 flex items-center gap-3 text-sm text-muted-foreground">
                <span>
                  {count} match{count === 1 ? "" : "es"}
                </span>
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            ) : null}

            {err ? <div className="mb-3 text-sm text-destructive">{err}</div> : null}

            {loading ? (
              <div className="text-center py-12 text-muted-foreground">Loading…</div>
            ) : mapped.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  {hasActiveFilters ? "No orders match your filters" : "No orders yet"}
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order #</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => toggleSort("created_at")}
                        >
                          Date {sortIcon("created_at")}
                        </TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => toggleSort("vendor_total")}
                        >
                          Vendor Total {sortIcon("vendor_total")}
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none"
                          onClick={() => toggleSort("status")}
                        >
                          Status {sortIcon("status")}
                        </TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {mapped.map((o) => (
                        <TableRow key={o.order_id}>
                          <TableCell className="font-medium">{o.order_number}</TableCell>

                          <TableCell>
                            <div className="text-sm">
                              {o.customerName || (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                            {o.customerPhone ? (
                              <div className="text-xs text-muted-foreground">
                                {o.customerPhone}
                              </div>
                            ) : null}
                          </TableCell>

                          <TableCell>{formatDate(o.created_at)}</TableCell>

                          <TableCell>{Number(o.item_qty ?? 0).toLocaleString()}</TableCell>

                          <TableCell>
                            {formatMoney(Number(o.vendor_total ?? 0), o.currency)}
                          </TableCell>

                          <TableCell>
                            <Badge variant={statusVariant(o.status) as any}>{o.status}</Badge>
                          </TableCell>

                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => router.push(`/vendor/orders/${o.order_id}`)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      {rangeStart}–{rangeEnd} of {count}
                    </span>
                    <span className="hidden sm:inline">·</span>
                    <label className="flex items-center gap-1">
                      <span className="hidden sm:inline">Rows</span>
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                      >
                        {PAGE_SIZES.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1 || loading}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages || loading}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
