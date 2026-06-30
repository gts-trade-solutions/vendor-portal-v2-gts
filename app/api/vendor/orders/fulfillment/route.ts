export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

/**
 * Per-vendor fulfillment for a (possibly multi-vendor) storefront order.
 * Vendor-scoped exactly like orders/detail: a vendor may only touch the
 * fulfillment of an order that contains >= 1 of THEIR products (else 404).
 * One vendor_order_fulfillment row per (order_id, vendor_id).
 */

const VALID_STATUSES = new Set(["PENDING", "DISPATCHED", "DELIVERED", "CANCELLED"]);

// Does this order include >= 1 line for one of the vendor's products?
async function vendorOwnsOrder(orderId: string, vendorId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ${orderId}
      AND p.vendor_id = ${vendorId}
  `;
  return Number(rows?.[0]?.n ?? 0) > 0;
}

// Best-effort public tracking URL from carrier + tracking number.
// Returns null for unknown carriers or a blank tracking number.
function deriveTrackingUrl(
  courier: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  const tn = (trackingNumber ?? "").trim();
  const c = (courier ?? "").trim().toLowerCase();
  if (!c) return null;
  if (!tn && c !== "dtdc") return null;
  const enc = encodeURIComponent(tn);
  switch (c) {
    case "delhivery":
      return `https://www.delhivery.com/track/package/${enc}`;
    case "bluedart":
    case "blue dart":
      return `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${enc}`;
    case "dtdc":
      return tn
        ? `https://trackcourier.io/dtdc-tracking/${enc}`
        : `https://www.dtdc.in/tracking.asp`;
    case "indiapost":
    case "india post":
      return `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx`;
    default:
      return null;
  }
}

function serialize(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    vendor_id: row.vendor_id,
    status: row.status,
    courier: row.courier ?? null,
    tracking_number: row.tracking_number ?? null,
    tracking_url: row.tracking_url ?? null,
    dispatched_at: row.dispatched_at ? new Date(row.dispatched_at).toISOString() : null,
    delivered_at: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
    notes: row.notes ?? null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vendorId = ctx.vendor.id;
  const orderId = req.nextUrl.searchParams.get("order_id") ?? "";
  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }

  if (!(await vendorOwnsOrder(orderId, vendorId))) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const row = await prisma.vendor_order_fulfillment.findUnique({
    where: { order_id_vendor_id: { order_id: orderId, vendor_id: vendorId } },
  });

  return NextResponse.json(
    { fulfillment: serialize(row) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  const vendorId = gate.vendor.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orderId: string = (body?.order_id ?? "").toString().trim();
  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }

  const status: string = (body?.status ?? "PENDING").toString().trim().toUpperCase();
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${Array.from(VALID_STATUSES).join(", ")}` },
      { status: 400 },
    );
  }

  const courier: string | null =
    body?.courier == null || body.courier === "" ? null : body.courier.toString();
  const trackingNumber: string | null =
    body?.tracking_number == null || body.tracking_number === ""
      ? null
      : body.tracking_number.toString();
  const notes: string | null =
    body?.notes == null || body.notes === "" ? null : body.notes.toString();

  if (!(await vendorOwnsOrder(orderId, vendorId))) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const trackingUrl = deriveTrackingUrl(courier, trackingNumber);
  const now = new Date();

  // Existing row (to decide whether to stamp dispatched_at the first time).
  const existing = await prisma.vendor_order_fulfillment.findUnique({
    where: { order_id_vendor_id: { order_id: orderId, vendor_id: vendorId } },
    select: { dispatched_at: true, delivered_at: true },
  });

  const dispatchedAt =
    status === "DISPATCHED"
      ? existing?.dispatched_at ?? now
      : existing?.dispatched_at ?? null;
  const deliveredAt =
    status === "DELIVERED"
      ? existing?.delivered_at ?? now
      : existing?.delivered_at ?? null;

  const row = await prisma.vendor_order_fulfillment.upsert({
    where: { order_id_vendor_id: { order_id: orderId, vendor_id: vendorId } },
    create: {
      id: randomUUID(),
      order_id: orderId,
      vendor_id: vendorId,
      status,
      courier,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      dispatched_at: dispatchedAt,
      delivered_at: deliveredAt,
      notes,
      updated_at: now,
    },
    update: {
      status,
      courier,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      dispatched_at: dispatchedAt,
      delivered_at: deliveredAt,
      notes,
      updated_at: now,
    },
  });

  await logActivity({
    vendorId,
    actorUserId: gate.userId,
    action: `fulfillment.${status.toLowerCase()}`,
    entityType: "order",
    entityId: orderId,
    summary: `Set fulfillment to ${status}`,
    meta: { courier, tracking_number: trackingNumber },
  });

  return NextResponse.json(
    { fulfillment: serialize(row) },
    { headers: { "cache-control": "no-store" } },
  );
}
