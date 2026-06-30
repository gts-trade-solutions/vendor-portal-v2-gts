"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  paid_at: string | null;
  total: number | null;
  total_inr: number | null;
  customer_name: string | null;
  customer_email: string | null;
  items_count: number;
  ordered_qty: number;
  allocated_qty: number;
};
type ItemRow = {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  inventory_product_id: string | null;
  allocated: number;
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const money = (v: unknown) => inr.format(Number(v) || 0);
const fmtDate = (d: string | null) => {
  if (!d) return "-";
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? "-" : x.toLocaleString("en-IN");
};

function statusClass(s: string) {
  if (s === "paid") return "bg-green-100 text-green-700";
  if (s === "cancelled" || s === "refunded" || s === "failed")
    return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

export default function OnlineOrdersPage() {
  const router = useRouter();

  const today = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 90 * 86400000)));
  const [to, setTo] = useState(ymd(today));

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/vendor/orders/online?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error((data && data.error) || "Failed to load orders");
        setRows([]);
      } else {
        setRows((data || []) as OrderRow[]);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load orders");
      setRows([]);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    setItemsLoading(true);
    try {
      const res = await fetch(
        `/api/vendor/orders/online/detail?id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      setItems((res.ok && Array.isArray(data) ? data : []) as ItemRow[]);
    } catch {
      setItems([]);
    }
    setItemsLoading(false);
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 py-8">
      <Button variant="outline" onClick={() => router.push("/vendor")}>
        ← Back to Dashboard
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Online Orders</h1>
          <p className="text-sm text-muted-foreground">
            Storefront sales. Paid orders automatically deplete linked inventory
            units.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">From</label>
            <Input
              type="date"
              className="w-40"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">To</label>
            <Input
              type="date"
              className="w-40"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Orders</CardTitle>
          <CardDescription>
            Click a row to see items and how many real units were allocated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              No online orders in this range.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left font-semibold">Order</th>
                    <th className="px-4 py-2 text-left font-semibold">Date</th>
                    <th className="px-4 py-2 text-left font-semibold">Customer</th>
                    <th className="px-4 py-2 text-right font-semibold">Total</th>
                    <th className="px-4 py-2 text-center font-semibold">Status</th>
                    <th className="px-4 py-2 text-center font-semibold">
                      Units Allocated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => {
                    const allocated = Number(o.allocated_qty);
                    const ordered = Number(o.ordered_qty);
                    const allocClass =
                      o.status !== "paid"
                        ? "text-muted-foreground"
                        : allocated >= ordered && ordered > 0
                          ? "text-green-700"
                          : allocated > 0
                            ? "text-amber-600"
                            : "text-red-600";
                    return (
                      <Fragment key={o.id}>
                        <tr
                          className="cursor-pointer border-t hover:bg-slate-50"
                          onClick={() => toggle(o.id)}
                        >
                          <td className="px-4 py-2 font-medium">
                            {o.order_number}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {fmtDate(o.paid_at)}
                          </td>
                          <td className="px-4 py-2">
                            <div>{o.customer_name || "-"}</div>
                            <div className="text-xs text-muted-foreground">
                              {o.customer_email || ""}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right font-medium">
                            {money(o.total_inr ?? o.total)}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-medium ${statusClass(o.status)}`}
                            >
                              {o.status}
                            </span>
                          </td>
                          <td className={`px-4 py-2 text-center font-medium ${allocClass}`}>
                            {allocated}/{ordered}
                          </td>
                        </tr>
                        {expanded === o.id && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={6} className="px-4 py-2">
                              {itemsLoading ? (
                                <div className="text-xs text-muted-foreground">
                                  Loading…
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  {items.map((it) => {
                                    const short = it.quantity - it.allocated;
                                    return (
                                      <div
                                        key={it.product_id}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background px-3 py-1.5 text-xs"
                                      >
                                        <span className="font-medium">{it.name}</span>
                                        <span className="text-muted-foreground">
                                          Qty {it.quantity} · {money(it.unit_price)}
                                        </span>
                                        {short > 0 ? (
                                          <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">
                                            {it.allocated}/{it.quantity} allocated · short {short}
                                          </span>
                                        ) : (
                                          <span className="rounded bg-green-100 px-2 py-0.5 text-green-700">
                                            {it.allocated}/{it.quantity} allocated
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
