export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped inventory_units status flip. Replaces the inline
// `supabase.from("inventory_units").update({ status, ... })` calls on the units
// page (single-row, scanned-row, RETURNED override, and the SOLD/DEMO/IN_STOCK
// transitions). Every row is constrained to the caller's vendor via the products
// relation (products.vendor_id) and to the given product_id.
//
// Body: { ids:[], productId, status, sold?:{id?,name,phone}, demo?:{id?,name,phone} }
//
// Field handling mirrors the page exactly:
//   - status === "SOLD"  + sold  -> set sold_customer_* + sold_at
//   - status === "DEMO"  + demo  -> set demo_customer_* + demo_at
//   - status === "IN_STOCK"      -> clear both sold_* and demo_* pointers
//     (used when reverting SOLD/DEMO back to stock)
//   - any other status           -> only the status column changes

const VALID = new Set([
  "IN_STOCK",
  "INVOICED",
  "DEMO",
  "SOLD",
  "RETURNED",
  "OUT_OF_STOCK",
]);

export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.map((x: any) => String(x)).filter(Boolean)
      : [];
    const productId: string | undefined = body?.productId
      ? String(body.productId)
      : undefined;
    const status = String(body?.status || "");

    if (ids.length === 0) return json({ ok: false, error: "NO_IDS" }, 400);
    if (!productId) return json({ ok: false, error: "MISSING_PRODUCT_ID" }, 400);
    if (!VALID.has(status)) return json({ ok: false, error: "INVALID_STATUS" }, 400);

    const data: Record<string, any> = { status };

    if (status === "SOLD" && body?.sold) {
      data.sold_customer_id = body.sold.id ?? null;
      data.sold_customer_name = body.sold.name ?? null;
      data.sold_customer_phone = body.sold.phone || null;
      data.sold_at = new Date();
    } else if (status === "DEMO" && body?.demo) {
      data.demo_customer_id = body.demo.id ?? null;
      data.demo_customer_name = body.demo.name ?? null;
      data.demo_customer_phone = body.demo.phone || null;
      data.demo_at = new Date();
    } else if (status === "IN_STOCK") {
      // revert: clear any customer pointers stored on the unit (matches page)
      data.sold_customer_id = null;
      data.sold_customer_name = null;
      data.sold_customer_phone = null;
      data.demo_customer_id = null;
      data.demo_customer_name = null;
      data.demo_customer_phone = null;
      data.demo_at = null;
    }

    const res = await prisma.inventory_units.updateMany({
      where: {
        id: { in: ids },
        product_id: productId,
        products: { vendor_id: vendorId },
      },
      data,
    });
    await logActivity({
      vendorId,
      actorUserId: gate.userId,
      action: "unit.status",
      entityType: "product",
      entityId: productId,
      summary: `Set ${res.count} unit${res.count === 1 ? "" : "s"} to ${status}`,
      meta: { count: res.count, status },
    });
    return json({ ok: true, count: res.count });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "STATUS_FAILED" }, 500);
  }
}
