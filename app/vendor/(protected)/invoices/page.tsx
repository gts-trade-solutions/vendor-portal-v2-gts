// app/admin/invoices/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { useVendorRole } from "@/lib/hooks/useVendorRole";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type InvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date?: string | null;
  customer_name: string;
  total_amount: number | null;
  grand_total?: number | null;
  amount_paid?: number | null;
  payment_status?: "UNPAID" | "PARTIAL" | "PAID" | null;
  created_at?: string | null;
  invoice_companies:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

type SortKey =
  | "invoice_date"
  | "grand_total"
  | "customer_name"
  | "payment_status"
  | "outstanding";

const SORT_KEYS: SortKey[] = [
  "invoice_date",
  "grand_total",
  "customer_name",
  "payment_status",
  "outstanding",
];

function formatCurrency(value?: number | null) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN");
}

function getOutstanding(inv: InvoiceRow) {
  const grand = Number(inv.grand_total ?? inv.total_amount ?? 0);
  const paid = Number(inv.amount_paid ?? 0);
  return Math.max(grand - paid, 0);
}

// Whole days a non-PAID invoice is past its due date (0 if not overdue / no due
// date / already paid). Computed against local midnight so a due_date of today
// is not yet "overdue".
function getDaysOverdue(inv: InvoiceRow): number {
  if (inv.payment_status === "PAID") return 0;
  if (!inv.due_date) return 0;
  const due = new Date(inv.due_date);
  if (Number.isNaN(due.getTime())) return 0;
  const today = new Date();
  const dueMid = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayMid = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const diff = Math.floor(
    (todayMid.getTime() - dueMid.getTime()) / (1000 * 60 * 60 * 24),
  );
  return diff > 0 ? diff : 0;
}

function paymentBadgeClass(status?: string | null) {
  if (status === "PAID") return "bg-green-100 text-green-700";
  if (status === "PARTIAL") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function getCompanyName(
  company:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null
) {
  if (!company) return "-";
  if (Array.isArray(company)) {
    return company[0]?.display_name || "-";
  }
  return company.display_name || "-";
}

export default function InvoicesListPage() {
  const router = useRouter();

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const sp = useSearchParams();
  const { isAdmin } = useVendorRole();

  // URL-driven list state, so opening an invoice and pressing Back returns to
  // the same page + filters (corporate-standard pagination history).
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(sp.get("size")))
    ? Number(sp.get("size"))
    : 20;
  const search = sp.get("q") || "";
  const companyFilter = sp.get("company") || "";
  const dateFrom = sp.get("from") || "";
  const dateTo = sp.get("to") || "";
  const payFilter = sp.get("pay") || "";
  const sortKey: SortKey = (SORT_KEYS as string[]).includes(sp.get("sort") || "")
    ? (sp.get("sort") as SortKey)
    : "invoice_date";
  const sortDir: "asc" | "desc" = sp.get("dir") === "asc" ? "asc" : "desc";

  // Row selection for bulk actions (keyed by invoice id, current page only).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const [searchInput, setSearchInput] = useState(search);
  const [companies, setCompanies] = useState<
    { id: string; display_name: string }[]
  >([]);
  const [totalCount, setTotalCount] = useState(0);

  // Merge a patch into the URL query (replace = no extra history entries while
  // filtering/paging; the only history push is navigating into an invoice).
  const setParams = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      const next = new URLSearchParams(window.location.search);
      Object.entries(patch).forEach(([k, val]) => {
        if (val === null || val === undefined || val === "") next.delete(k);
        else next.set(k, String(val));
      });
      const qs = next.toString();
      router.replace(qs ? `/vendor/invoices?${qs}` : "/vendor/invoices");
    },
    [router],
  );

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<InvoiceRow | null>(null);
  const [revertUnitCount, setRevertUnitCount] = useState<number | null>(null);

  // When the delete confirmation opens, look up how many stock units will be
  // returned to IN_STOCK so we can tell the user before they confirm.
  useEffect(() => {
    if (!confirmDelete) {
      setRevertUnitCount(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/vendor/invoice-units?invoice_id=${encodeURIComponent(confirmDelete.id)}&count=1`,
          { cache: "no-store" },
        );
        const json = await res.json().catch(() => ({}));
        if (active) setRevertUnitCount(Number(json?.count ?? 0));
      } catch {
        if (active) setRevertUnitCount(0);
      }
    })();
    return () => {
      active = false;
    };
  }, [confirmDelete]);

  // Debounced search box -> URL.
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = searchInput.trim();
      if (trimmed !== search) setParams({ q: trimmed || null, page: 1 });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Keep the search box in sync when the URL changes externally (e.g. Back).
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  // Companies for the filter dropdown.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/vendor/invoice-companies", {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        setCompanies(
          (json?.data || []) as { id: string; display_name: string }[],
        );
      } catch {
        setCompanies([]);
      }
    })();
  }, []);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(totalCount / pageSize));
  }, [totalCount, pageSize]);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Server-authoritative, vendor-scoped list. All filters (search incl.
      // product-description match, company, date range, payment, pagination)
      // and the total count are computed in the API route.
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("size", String(pageSize));
      if (search) qs.set("q", search);
      if (companyFilter) qs.set("company", companyFilter);
      if (dateFrom) qs.set("from", dateFrom);
      if (dateTo) qs.set("to", dateTo);
      if (payFilter) qs.set("pay", payFilter);
      qs.set("sort", sortKey);
      qs.set("dir", sortDir);

      const res = await fetch(`/api/vendor/invoices?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load invoices");
      }

      setInvoices((json.data || []) as InvoiceRow[]);
      setTotalCount(Number(json.count || 0));
      setSelected(new Set()); // selection is page-scoped; reset on any reload
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to load invoices");
      setInvoices([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    search,
    companyFilter,
    dateFrom,
    dateTo,
    payFilter,
    sortKey,
    sortDir,
  ]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    if (!loading && totalCount > 0 && page > totalPages) {
      setParams({ page: totalPages });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, totalPages, loading, totalCount]);

  const handleDelete = async () => {
    if (!confirmDelete) return;

    setError(null);
    setDeletingId(confirmDelete.id);

    try {
      const res = await fetch("/api/vendor/invoices/soft-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: confirmDelete.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to delete invoice");
      }

      const deletingLastRowOnPage = invoices.length === 1 && page > 1;

      toast.success(
        revertUnitCount && revertUnitCount > 0
          ? `Moved to Trash. ${revertUnitCount} unit${revertUnitCount > 1 ? "s" : ""} returned to stock.`
          : "Moved to Trash.",
      );

      setConfirmDelete(null);

      if (deletingLastRowOnPage) {
        setParams({ page: Math.max(1, page - 1) });
      } else {
        await loadInvoices();
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to delete invoice");
      toast.error(err?.message || "Failed to delete invoice");
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = async (inv: InvoiceRow) => {
    setDuplicatingId(inv.id);
    try {
      const res = await fetch(
        `/api/vendor/invoices/duplicate?id=${encodeURIComponent(inv.id)}`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || !json?.id) {
        throw new Error(json?.error || "Failed to duplicate invoice");
      }
      toast.success("Invoice duplicated. Editing the copy.");
      router.push(`/vendor/invoices/${json.id}/edit`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to duplicate invoice");
    } finally {
      setDuplicatingId(null);
    }
  };

  // ---- Sorting ----
  // Click a header: same column toggles dir; new column starts desc (asc for the
  // text column customer_name, which reads more naturally A→Z first).
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setParams({ dir: sortDir === "asc" ? "desc" : "asc", page: 1 });
    } else {
      setParams({ sort: key, dir: key === "customer_name" ? "asc" : "desc", page: 1 });
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  // ---- Selection ----
  const allOnPageSelected =
    invoices.length > 0 && invoices.every((inv) => selected.has(inv.id));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (invoices.length > 0 && invoices.every((inv) => prev.has(inv.id))) {
        return new Set();
      }
      return new Set(invoices.map((inv) => inv.id));
    });
  };

  const toggleSelectOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => invoices.filter((inv) => selected.has(inv.id)),
    [invoices, selected],
  );

  // ---- Bulk: email selected (sequential) ----
  const handleBulkEmail = async () => {
    if (selectedRows.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    const total = selectedRows.length;
    for (const inv of selectedRows) {
      try {
        const res = await fetch(`/api/invoices/${inv.id}/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "invoice" }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok) ok += 1;
      } catch {
        /* counted as failure */
      }
    }
    setBulkBusy(false);
    if (ok === total) toast.success(`Emailed ${ok}/${total}`);
    else toast.error(`Emailed ${ok}/${total}`);
  };

  // ---- Bulk: move selected to trash (admin only, sequential) ----
  const handleBulkDelete = async () => {
    if (selectedRows.length === 0) return;
    setConfirmBulkDelete(false);
    setBulkBusy(true);
    let ok = 0;
    const total = selectedRows.length;
    for (const inv of selectedRows) {
      try {
        const res = await fetch("/api/vendor/invoices/soft-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_id: inv.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok) ok += 1;
      } catch {
        /* counted as failure */
      }
    }
    setBulkBusy(false);
    if (ok === total) toast.success(`Moved ${ok}/${total} to Trash`);
    else toast.error(`Moved ${ok}/${total} to Trash`);
    await loadInvoices();
  };

  // ---- Export ----
  // Build the worksheet rows from a set of invoices, append a TOTAL row, and
  // download as XLSX.
  const exportRows = (rows: InvoiceRow[], filename: string) => {
    const sheet: Record<string, string | number>[] = rows.map((inv) => {
      const billed = Number(inv.grand_total ?? inv.total_amount ?? 0);
      const paid = Number(inv.amount_paid ?? 0);
      return {
        "Invoice#": inv.invoice_number || "",
        Date: formatDate(inv.invoice_date),
        Due: formatDate(inv.due_date),
        Company: getCompanyName(inv.invoice_companies),
        Customer: inv.customer_name || "",
        Billed: billed,
        Paid: paid,
        Outstanding: Math.max(billed - paid, 0),
        Status: inv.payment_status || "UNPAID",
      };
    });

    const totals = rows.reduce(
      (acc, inv) => {
        const billed = Number(inv.grand_total ?? inv.total_amount ?? 0);
        const paid = Number(inv.amount_paid ?? 0);
        acc.billed += billed;
        acc.paid += paid;
        acc.outstanding += Math.max(billed - paid, 0);
        return acc;
      },
      { billed: 0, paid: 0, outstanding: 0 },
    );

    sheet.push({
      "Invoice#": "TOTAL",
      Date: "",
      Due: "",
      Company: "",
      Customer: "",
      Billed: totals.billed,
      Paid: totals.paid,
      Outstanding: totals.outstanding,
      Status: "",
    });

    const ws = XLSX.utils.json_to_sheet(sheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invoices");
    XLSX.writeFile(wb, filename);
  };

  const exportFilename = () => {
    const f = dateFrom || "all";
    const t = dateTo || "all";
    return `invoices_${f}_to_${t}.xlsx`;
  };

  // Export the CURRENT FILTERED result set (all matching rows, not just the
  // page) by re-querying the list endpoint with all=1.
  const handleExportAll = async () => {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      qs.set("all", "1");
      if (search) qs.set("q", search);
      if (companyFilter) qs.set("company", companyFilter);
      if (dateFrom) qs.set("from", dateFrom);
      if (dateTo) qs.set("to", dateTo);
      if (payFilter) qs.set("pay", payFilter);
      qs.set("sort", sortKey);
      qs.set("dir", sortDir);

      const res = await fetch(`/api/vendor/invoices?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to export invoices");
      }
      const rows = (json.data || []) as InvoiceRow[];
      if (rows.length === 0) {
        toast.error("No invoices to export");
        return;
      }
      exportRows(rows, exportFilename());
      toast.success(`Exported ${rows.length} invoices`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to export invoices");
    } finally {
      setExporting(false);
    }
  };

  const handleExportSelected = () => {
    if (selectedRows.length === 0) return;
    exportRows(selectedRows, exportFilename());
    toast.success(`Exported ${selectedRows.length} invoices`);
  };

  const summaryText = useMemo(() => {
    if (loading) return "Loading invoices...";
    if (totalCount === 0) return "No invoices found";
    const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, totalCount);
    return `Showing ${from}-${to} of ${totalCount} invoices`;
  }, [loading, totalCount, page, pageSize]);

  return (
    <div className="container mx-auto max-w-7xl space-y-4 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" onClick={() => router.push("/vendor")}>
          Back
        </Button>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => router.push("/vendor/invoices/trash")}
            >
              Trash
            </Button>
            <Button onClick={() => router.push("/vendor/invoices/new")}>
              + New Invoice
            </Button>
          </div>
        )}
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>
              View, edit, print, and manage invoices generated in the system.
            </CardDescription>
          </div>

          <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {summaryText}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex w-full flex-col gap-3 sm:flex-row">
              <div className="w-full max-w-md">
                <Input
                  placeholder="Search by invoice no., customer, or product..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>

              <Button
                variant="outline"
                onClick={() => {
                  setSearchInput("");
                  setParams({
                    q: null,
                    company: null,
                    from: null,
                    to: null,
                    pay: null,
                    page: 1,
                  });
                }}
                disabled={
                  !searchInput &&
                  !search &&
                  !companyFilter &&
                  !dateFrom &&
                  !dateTo &&
                  !payFilter
                }
              >
                Clear filters
              </Button>

              <Button
                variant="outline"
                onClick={handleExportAll}
                disabled={exporting || loading || totalCount === 0}
              >
                {exporting ? "Exporting…" : "Export"}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Rows</label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={pageSize}
                onChange={(e) =>
                  setParams({ size: Number(e.target.value), page: 1 })
                }
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter panel */}
          <div className="flex flex-col gap-3 rounded-lg border bg-slate-50/60 p-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                Company
              </label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-56"
                value={companyFilter}
                onChange={(e) =>
                  setParams({ company: e.target.value || null, page: 1 })
                }
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                From date
              </label>
              <Input
                type="date"
                className="sm:w-40"
                value={dateFrom}
                onChange={(e) =>
                  setParams({ from: e.target.value || null, page: 1 })
                }
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                To date
              </label>
              <Input
                type="date"
                className="sm:w-40"
                value={dateTo}
                onChange={(e) =>
                  setParams({ to: e.target.value || null, page: 1 })
                }
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                Payment
              </label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-40"
                value={payFilter}
                onChange={(e) =>
                  setParams({ pay: e.target.value || null, page: 1 })
                }
              >
                <option value="">All payments</option>
                <option value="UNPAID">Unpaid</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Paid</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="space-y-2 rounded-lg border p-4">
              <div className="h-10 animate-pulse rounded bg-slate-100" />
              <div className="h-10 animate-pulse rounded bg-slate-100" />
              <div className="h-10 animate-pulse rounded bg-slate-100" />
              <div className="h-10 animate-pulse rounded bg-slate-100" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <div className="text-base font-medium text-slate-900">
                No invoices found
              </div>
              <div className="mt-1 text-sm text-slate-500">
                Try a different search, or create a new invoice.
              </div>
              <div className="mt-4">
                <Button onClick={() => router.push("/vendor/invoices/new")}>
                  + New Invoice
                </Button>
              </div>
            </div>
          ) : (
            <>
              {selected.size > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-slate-300 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-medium text-slate-700">
                    {selected.size} selected
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBulkEmail}
                      disabled={bulkBusy}
                    >
                      {bulkBusy ? "Working…" : "Email"}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleExportSelected}
                      disabled={bulkBusy}
                    >
                      Export Selected
                    </Button>

                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setConfirmBulkDelete(true)}
                        disabled={bulkBusy}
                      >
                        Move to Trash
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelected(new Set())}
                      disabled={bulkBusy}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="border-b">
                      <th className="px-4 py-3 text-center font-semibold">
                        <input
                          type="checkbox"
                          aria-label="Select all on this page"
                          className="h-4 w-4 cursor-pointer align-middle"
                          checked={allOnPageSelected}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-4 py-3 text-left font-semibold">
                        Invoice No.
                      </th>
                      <th
                        className="cursor-pointer select-none px-4 py-3 text-left font-semibold hover:text-slate-900"
                        onClick={() => toggleSort("invoice_date")}
                      >
                        Date{sortIndicator("invoice_date")}
                      </th>
                      <th className="px-4 py-3 text-left font-semibold">
                        Company
                      </th>
                      <th
                        className="cursor-pointer select-none px-4 py-3 text-left font-semibold hover:text-slate-900"
                        onClick={() => toggleSort("customer_name")}
                      >
                        Customer{sortIndicator("customer_name")}
                      </th>
                      <th
                        className="cursor-pointer select-none px-4 py-3 text-right font-semibold hover:text-slate-900"
                        onClick={() => toggleSort("grand_total")}
                      >
                        Total{sortIndicator("grand_total")}
                      </th>
                      <th
                        className="cursor-pointer select-none px-4 py-3 text-right font-semibold hover:text-slate-900"
                        onClick={() => toggleSort("outstanding")}
                      >
                        Outstanding{sortIndicator("outstanding")}
                      </th>
                      <th
                        className="cursor-pointer select-none px-4 py-3 text-center font-semibold hover:text-slate-900"
                        onClick={() => toggleSort("payment_status")}
                      >
                        Payment{sortIndicator("payment_status")}
                      </th>
                      <th className="px-4 py-3 text-center font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {invoices.map((inv) => {
                      const daysOverdue = getDaysOverdue(inv);
                      return (
                      <tr
                        key={inv.id}
                        className="border-t transition-colors hover:bg-slate-50"
                      >
                        <td className="px-4 py-3 text-center align-middle">
                          <input
                            type="checkbox"
                            aria-label={`Select invoice ${inv.invoice_number || ""}`}
                            className="h-4 w-4 cursor-pointer align-middle"
                            checked={selected.has(inv.id)}
                            onChange={() => toggleSelectOne(inv.id)}
                          />
                        </td>
                        <td className="px-4 py-3 align-middle font-medium text-slate-900">
                          {inv.invoice_number || "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-700">
                          {formatDate(inv.invoice_date)}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-700">
                          {getCompanyName(inv.invoice_companies)}
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-700">
                          {inv.customer_name || "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-right font-medium text-slate-900">
                          {formatCurrency(inv.grand_total ?? inv.total_amount)}
                        </td>
                        <td className="px-4 py-3 align-middle text-right text-slate-700">
                          {getOutstanding(inv) > 0
                            ? formatCurrency(getOutstanding(inv))
                            : "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${paymentBadgeClass(
                                inv.payment_status,
                              )}`}
                            >
                              {inv.payment_status || "UNPAID"}
                            </span>
                            {daysOverdue > 0 && (
                              <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                {daysOverdue}d overdue
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                router.push(`/vendor/invoices/${inv.id}`)
                              }
                            >
                              View
                            </Button>

                            {isAdmin && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    router.push(
                                      `/vendor/invoices/${inv.id}/edit`,
                                    )
                                  }
                                >
                                  Edit
                                </Button>

                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={duplicatingId === inv.id}
                                  onClick={() => handleDuplicate(inv)}
                                >
                                  {duplicatingId === inv.id
                                    ? "Duplicating…"
                                    : "Duplicate"}
                                </Button>

                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={deletingId === inv.id}
                                  onClick={() => setConfirmDelete(inv)}
                                >
                                  {deletingId === inv.id ? "Moving…" : "Trash"}
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-600">{summaryText}</div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setParams({ page: 1 })}
                    disabled={page <= 1}
                  >
                    « First
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => setParams({ page: Math.max(1, page - 1) })}
                    disabled={page <= 1}
                  >
                    Prev
                  </Button>

                  <div className="min-w-[120px] text-center text-sm font-medium">
                    Page {page} of {totalPages}
                  </div>

                  <Button
                    variant="outline"
                    onClick={() =>
                      setParams({ page: Math.min(totalPages, page + 1) })
                    }
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => setParams({ page: totalPages })}
                    disabled={page >= totalPages}
                  >
                    Last »
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              Move invoice to Trash?
            </h3>

            <p className="mt-2 text-sm text-slate-600">
              The invoice will be moved to Trash and can be restored later from
              the Trash page.
            </p>

            <div className="mt-4 rounded-lg border bg-slate-50 p-4 text-sm">
              <div>
                <span className="font-medium">Invoice No:</span>{" "}
                {confirmDelete.invoice_number || "-"}
              </div>
              <div className="mt-1">
                <span className="font-medium">Customer:</span>{" "}
                {confirmDelete.customer_name || "-"}
              </div>
              <div className="mt-1">
                <span className="font-medium">Company:</span>{" "}
                {getCompanyName(confirmDelete.invoice_companies)}
              </div>
              <div className="mt-1">
                <span className="font-medium">Amount:</span>{" "}
                {formatCurrency(confirmDelete.total_amount)}
              </div>
            </div>

            {revertUnitCount !== null && revertUnitCount > 0 && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                {revertUnitCount} stock unit{revertUnitCount > 1 ? "s" : ""} linked
                to this invoice will be automatically returned to{" "}
                <span className="font-medium">IN_STOCK</span> when you delete it.
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (deletingId) return;
                  setConfirmDelete(null);
                }}
                disabled={!!deletingId}
              >
                Cancel
              </Button>

              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={!!deletingId}
              >
                {deletingId ? "Moving…" : "Move to Trash"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              Move {selected.size} invoice{selected.size > 1 ? "s" : ""} to
              Trash?
            </h3>

            <p className="mt-2 text-sm text-slate-600">
              The selected invoices will be moved to Trash and can be restored
              later from the Trash page. Any linked stock units will be returned
              to IN_STOCK.
            </p>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmBulkDelete(false)}
                disabled={bulkBusy}
              >
                Cancel
              </Button>

              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={bulkBusy}
              >
                {bulkBusy ? "Moving…" : "Move to Trash"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}