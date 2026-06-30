"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { LogOut, Printer, Package, RefreshCw, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useVendorRole } from "@/lib/hooks/useVendorRole";

type Fulfillment = {
  id: string;
  order_id: string;
  vendor_id: string;
  status: string;
  courier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type VendorOrderDetail = {
  order_id: string;
  order_number: string;
  status: string;
  created_at: string;
  currency: string;
  address_snapshot: any;
  vendor_subtotal: number;
  items: Array<{
    product_id: string | null;
    sku: string | null;
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    mrp?: number | null;
    hero_image_path?: string | null;
  }>;
};

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

function statusVariant(status: string) {
  const s = (status || "").toLowerCase();
  if (["delivered"].includes(s)) return "default";
  if (["shipped", "dispatched"].includes(s)) return "secondary";
  if (["cancelled"].includes(s)) return "destructive";
  return "outline";
}

function fulfillmentVariant(status: string) {
  switch ((status || "").toUpperCase()) {
    case "DELIVERED":
      return "default";
    case "DISPATCHED":
      return "secondary";
    case "CANCELLED":
      return "destructive";
    default:
      return "outline";
  }
}

export default function VendorOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user, logout } = useAuth();
  const { isAdmin } = useVendorRole();
  const orderId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<VendorOrderDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [fulfillment, setFulfillment] = useState<Fulfillment | null>(null);
  const [saving, setSaving] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");

  const load = async () => {
    setLoading(true);
    setErr(null);

    let res: Response;
    let row: any;
    try {
      res = await fetch(
        `/api/vendor/orders/detail?id=${encodeURIComponent(orderId)}`,
        { cache: "no-store" },
      );
      row = await res.json();
    } catch (e: any) {
      console.error("vendor order detail error", e);
      setDetail(null);
      setErr(e?.message || "Failed to load order");
      setLoading(false);
      return;
    }

    if (res.status === 404) {
      setDetail(null);
      setErr("Order not found (or does not include your products)");
      setLoading(false);
      return;
    }

    if (!res.ok || !row?.order_id) {
      console.error("vendor order detail error", row);
      setDetail(null);
      setErr((row && row.error) || "Failed to load order");
      setLoading(false);
      return;
    }

    setDetail({
      order_id: row.order_id,
      order_number: row.order_number,
      status: row.status,
      created_at: row.created_at,
      currency: row.currency,
      address_snapshot: safeParseSnapshot(row.address_snapshot),
      vendor_subtotal: Number(row.vendor_subtotal ?? 0),
      items: Array.isArray(row.items)
        ? row.items
        : (() => {
            // Defensive: never let a malformed `items` string throw out of
            // setDetail() and leave the page stuck on "Loading…".
            try {
              return row.items ? JSON.parse(row.items) : [];
            } catch {
              return [];
            }
          })(),
    });

    setLoading(false);
    void loadFulfillment();
  };

  const loadFulfillment = async () => {
    try {
      const res = await fetch(
        `/api/vendor/orders/fulfillment?order_id=${encodeURIComponent(orderId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = await res.json();
      const f: Fulfillment | null = json?.fulfillment ?? null;
      setFulfillment(f);
      if (f) {
        if (f.courier) setCarrier(f.courier);
        if (f.tracking_number) setTrackingNumber(f.tracking_number);
      }
    } catch (e) {
      console.error("vendor fulfillment load error", e);
    }
  };

  const postFulfillment = async (
    status: "DISPATCHED" | "DELIVERED" | "CANCELLED",
    extra?: { courier?: string; tracking_number?: string },
  ) => {
    setSaving(true);
    try {
      const res = await fetch("/api/vendor/orders/fulfillment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, status, ...(extra ?? {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || "Failed to update fulfillment");
        return;
      }
      setFulfillment(json?.fulfillment ?? null);
      toast.success(
        status === "DISPATCHED"
          ? "Order marked as dispatched"
          : status === "DELIVERED"
            ? "Order marked as delivered"
            : "Fulfillment cancelled",
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to update fulfillment");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!orderId) return;
    load();
  }, [orderId]);

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out successfully");
    router.push("/");
  };

  const handleMarkDispatched = () => {
    if (!trackingNumber.trim() || !carrier) {
      toast.error("Please select a carrier and enter a tracking number");
      return;
    }
    void postFulfillment("DISPATCHED", {
      courier: carrier,
      tracking_number: trackingNumber.trim(),
    });
  };

  const handleMarkDelivered = () => {
    void postFulfillment("DELIVERED");
  };

  const handleCancelFulfillment = () => {
    void postFulfillment("CANCELLED");
  };

  const handlePrintInvoice = () => {
    // TODO prefill from order (line-items, customer, vendor subtotal)
    router.push("/vendor/invoices/new");
  };

  const ship = detail?.address_snapshot || null;

  const itemCount = useMemo(() => {
    return (detail?.items ?? []).reduce((a, i) => a + (Number(i.quantity) || 0), 0);
  }, [detail?.items]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/vendor/orders")}>
              ← Back
            </Button>
            <h1 className="text-2xl font-bold">
              Order {detail?.order_number ? `#${detail.order_number}` : `#${orderId.slice(0, 8)}`}
            </h1>
            {detail?.status ? (
              <Badge variant={statusVariant(detail.status) as any}>{detail.status}</Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
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
        {err ? <div className="mb-4 text-sm text-destructive">{err}</div> : null}

        {loading ? (
          <div className="py-16 text-center text-muted-foreground">Loading…</div>
        ) : !detail ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              Order not available.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Order Information</CardTitle>
                <CardDescription>Customer and order details (your items only)</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Placed On</div>
                    <div className="font-medium">
                      {new Date(detail.created_at).toLocaleString("en-IN")}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground">Items (your products)</div>
                    <div className="font-medium">{itemCount}</div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground">Vendor Subtotal</div>
                    <div className="font-medium">{formatMoney(detail.vendor_subtotal, detail.currency)}</div>
                  </div>
                </div>

                <div className="rounded-md border p-4">
                  <div className="text-sm font-medium mb-2">Shipping Snapshot</div>
                  {ship ? (
                    <div className="text-sm">
                      <div className="font-medium">{ship.name || "—"}</div>
                      <div>{ship.address || ship.line1 || "—"}</div>
                      <div>
                        {(ship.city || "—")}, {(ship.state || "—")} - {(ship.pincode || "—")}
                      </div>
                      <div className="text-muted-foreground">
                        {ship.phone || ""} {ship.email ? `· ${ship.email}` : ""}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No shipping snapshot available.</div>
                  )}
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit</TableHead>
                        <TableHead className="text-right">Line Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail.items ?? []).map((it, idx) => (
                        <TableRow key={`${it.product_id ?? "x"}-${idx}`}>
                          <TableCell>{it.sku || "—"}</TableCell>
                          <TableCell className="font-medium">{it.name}</TableCell>
                          <TableCell className="text-right">{Number(it.quantity ?? 0)}</TableCell>
                          <TableCell className="text-right">{formatMoney(Number(it.unit_price ?? 0), detail.currency)}</TableCell>
                          <TableCell className="text-right">{formatMoney(Number(it.line_total ?? 0), detail.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>Fulfillment</CardTitle>
                    <CardDescription>
                      {isAdmin
                        ? "Dispatch and track this order (your items)"
                        : "Fulfillment status (view-only — owner/manager can update)"}
                    </CardDescription>
                  </div>
                  <Badge variant={fulfillmentVariant(fulfillment?.status ?? "PENDING") as any}>
                    {fulfillment?.status ?? "PENDING"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  {/* Status / timestamps */}
                  <div className="rounded-md border p-4 text-sm grid gap-1">
                    {fulfillment?.dispatched_at ? (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Dispatched:</span>
                        <span className="font-medium">
                          {new Date(fulfillment.dispatched_at).toLocaleString("en-IN")}
                        </span>
                      </div>
                    ) : null}
                    {fulfillment?.delivered_at ? (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Delivered:</span>
                        <span className="font-medium">
                          {new Date(fulfillment.delivered_at).toLocaleString("en-IN")}
                        </span>
                      </div>
                    ) : null}
                    {fulfillment?.courier ? (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Carrier:</span>
                        <span className="font-medium capitalize">{fulfillment.courier}</span>
                      </div>
                    ) : null}
                    {fulfillment?.tracking_number ? (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Tracking #:</span>
                        <span className="font-medium">{fulfillment.tracking_number}</span>
                      </div>
                    ) : null}
                    {fulfillment?.tracking_url ? (
                      <a
                        href={fulfillment.tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline w-fit"
                      >
                        Track shipment <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {!fulfillment ? (
                      <div className="text-muted-foreground">
                        No fulfillment yet — this order has not been dispatched.
                      </div>
                    ) : null}
                  </div>

                  {isAdmin ? (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor="carrier">Shipping Carrier</Label>
                        <Select value={carrier} onValueChange={setCarrier}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select carrier" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="delhivery">Delhivery</SelectItem>
                            <SelectItem value="bluedart">Blue Dart</SelectItem>
                            <SelectItem value="dtdc">DTDC</SelectItem>
                            <SelectItem value="indiapost">India Post</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="tracking">Tracking Number</Label>
                        <Input
                          id="tracking"
                          value={trackingNumber}
                          onChange={(e) => setTrackingNumber(e.target.value)}
                          placeholder="Enter tracking number"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={handleMarkDispatched}
                          disabled={saving}
                          className="flex-1 min-w-[200px]"
                        >
                          <Package className="mr-2 h-4 w-4" />
                          {fulfillment?.status === "DISPATCHED" ? "Update Dispatch" : "Save / Mark as Dispatched"}
                        </Button>

                        {fulfillment?.status === "DISPATCHED" ? (
                          <Button
                            variant="secondary"
                            onClick={handleMarkDelivered}
                            disabled={saving}
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Mark as Delivered
                          </Button>
                        ) : null}

                        <Button variant="outline" onClick={handlePrintInvoice}>
                          <Printer className="mr-2 h-4 w-4" />
                          Print Invoice
                        </Button>
                      </div>

                      {fulfillment && fulfillment.status !== "CANCELLED" ? (
                        <button
                          type="button"
                          onClick={handleCancelFulfillment}
                          disabled={saving}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive w-fit disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Cancel fulfillment
                        </button>
                      ) : null}

                      <p className="text-xs text-muted-foreground">
                        Shipping label printing — coming soon.
                      </p>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
