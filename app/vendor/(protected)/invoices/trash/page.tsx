"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useVendorRole } from "@/lib/hooks/useVendorRole";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type TrashRow = {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  customer_name: string;
  total_amount: number | null;
  grand_total: number | null;
  deleted_at: string | null;
  invoice_companies:
    | { display_name: string }
    | { display_name: string }[]
    | null;
};

function formatCurrency(value?: number | null) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("en-IN");
}

function getCompanyName(
  company:
    | { display_name: string }
    | { display_name: string }[]
    | null,
) {
  if (!company) return "-";
  if (Array.isArray(company)) return company[0]?.display_name || "-";
  return company.display_name || "-";
}

export default function InvoiceTrashPage() {
  const router = useRouter();
  const { isAdmin } = useVendorRole();

  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<TrashRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/invoices?trash=1", {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        toast.error(json?.error || "Failed to load trash");
        setRows([]);
      } else {
        setRows((json.data || []) as TrashRow[]);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load trash");
      setRows([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (row: TrashRow) => {
    setBusyId(row.id);
    let data: any = null;
    let error: { message?: string } | null = null;
    try {
      const res = await fetch("/api/vendor/invoices/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: row.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        error = { message: json?.error || "Failed to restore" };
      } else {
        data = json;
      }
    } catch (e: any) {
      error = { message: e?.message || "Failed to restore" };
    }
    setBusyId(null);
    if (error) {
      toast.error(error.message || "Failed to restore");
      return;
    }
    const restored = Number((data as any)?.restored ?? 0);
    const skipped = Number((data as any)?.skipped ?? 0);
    toast.success(
      `Invoice restored. ${restored} unit${restored === 1 ? "" : "s"} re-marked sold` +
        (skipped
          ? `; ${skipped} could not be restored (no longer available).`
          : "."),
    );
    await load();
  };

  const purge = async () => {
    if (!confirmPurge) return;
    setBusyId(confirmPurge.id);
    let error: { message?: string } | null = null;
    try {
      const res = await fetch(
        `/api/vendor/invoices/purge?id=${encodeURIComponent(confirmPurge.id)}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        error = { message: json?.error || "Failed to delete permanently" };
      }
    } catch (e: any) {
      error = { message: e?.message || "Failed to delete permanently" };
    }
    setBusyId(null);
    if (error) {
      toast.error(error.message || "Failed to delete permanently");
      return;
    }
    toast.success("Invoice permanently deleted.");
    setConfirmPurge(null);
    await load();
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-4 py-6">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => router.push("/vendor/invoices")}
        >
          ← Back to Invoices
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Trash</CardTitle>
          <CardDescription>
            Deleted invoices. Restore to bring an invoice back (its units are
            re-marked sold), or permanently delete it.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-2 rounded-lg border p-4">
              <div className="h-10 animate-pulse rounded bg-slate-100" />
              <div className="h-10 animate-pulse rounded bg-slate-100" />
              <div className="h-10 animate-pulse rounded bg-slate-100" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-slate-500">
              Trash is empty.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left font-semibold">
                      Invoice No.
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Company
                    </th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Deleted On
                    </th>
                    <th className="px-4 py-3 text-center font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {row.invoice_number || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.customer_name || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {getCompanyName(row.invoice_companies)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(row.grand_total ?? row.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDateTime(row.deleted_at)}
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            <Button
                              size="sm"
                              disabled={busyId === row.id}
                              onClick={() => restore(row)}
                            >
                              {busyId === row.id ? "Working…" : "Restore"}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busyId === row.id}
                              onClick={() => setConfirmPurge(row)}
                            >
                              Delete Forever
                            </Button>
                          </div>
                        ) : (
                          <span className="text-center text-xs text-muted-foreground">
                            View-only
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {confirmPurge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              Permanently delete invoice?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This cannot be undone. Invoice{" "}
              <span className="font-medium">
                {confirmPurge.invoice_number || "-"}
              </span>{" "}
              and its line items will be removed permanently.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmPurge(null)}
                disabled={!!busyId}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={purge}
                disabled={!!busyId}
              >
                {busyId ? "Deleting…" : "Delete Forever"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
