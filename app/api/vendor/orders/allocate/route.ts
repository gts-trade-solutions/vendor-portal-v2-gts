export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { allocateOrderUnits } from "@/lib/orders/allocateOrderUnits";

/**
 * MySQL port of Postgres RPC `allocate_order_units(p_order_id)`.
 * Idempotent: for a paid order, allocates real inventory_units against each
 * line item up to the ordered quantity, filling only the remaining shortfall.
 * Re-running is a no-op once fully allocated. The original RPC has no role
 * gate, so this stays authenticated-only (getRouteVendor non-null).
 *   body: { order_id }
 */
export async function POST(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const orderId = String(body?.order_id || "").trim();
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "order_id is required" }, { status: 400 });
  }

  try {
    const result = await allocateOrderUnits(orderId);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("vendor/orders/allocate POST error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to allocate units" },
      { status: 500 },
    );
  }
}
