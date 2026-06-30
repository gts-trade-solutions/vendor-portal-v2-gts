export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped inventory_units field update. Replaces the browser
// `supabase.from("inventory_units").update(patch)` calls on the units page:
//   - markVerified (is_verified / verified_at / verified_by)
//   - the unit-edit dialog (manufacture_date / expiry_date / status)
//   - bulk edit (status + dates)
// EVERY row touched is constrained to the caller's vendor via the products
// relation filter (products.vendor_id) so a vendor can never edit another
// vendor's units. Optionally also constrained to a product_id when provided.
//
// Body: { ids:[], productId?, patch:{...} }
// Only the whitelisted columns below are accepted; unknown keys are rejected.

// Columns the page legitimately sets on inventory_units. Anything outside this
// set is refused (a caller cannot, e.g., re-stamp vendor_id or price arbitrarily
// through this generic endpoint).
const DATE_COLS = new Set([
  "manufacture_date",
  "expiry_date",
  "mfg_date",
  "exp_date",
  "verified_at",
  "sold_at",
  "demo_at",
]);
const ALLOWED = new Set([
  "status",
  "unit_code",
  "mfg_date",
  "exp_date",
  "manufacture_date",
  "expiry_date",
  "is_verified",
  "verified_at",
  "verified_by",
  "sold_customer_id",
  "sold_customer_name",
  "sold_customer_phone",
  "sold_at",
  "demo_customer_id",
  "demo_customer_name",
  "demo_customer_phone",
  "demo_at",
  "price",
  "scan_code",
]);

function sanitizePatch(raw: any): { data: Record<string, any>; bad?: string } {
  const data: Record<string, any> = {};
  if (!raw || typeof raw !== "object") return { data, bad: "patch is required" };
  for (const k of Object.keys(raw)) {
    if (!ALLOWED.has(k)) return { data, bad: `unknown patch key: ${k}` };
    let v = raw[k];
    if (DATE_COLS.has(k) && typeof v === "string" && v) v = new Date(v);
    if (k === "price" && v != null) v = Number(v);
    data[k] = v;
  }
  return { data };
}

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

    if (ids.length === 0) return json({ ok: false, error: "NO_IDS" }, 400);

    const { data, bad } = sanitizePatch(body?.patch);
    if (bad) return json({ ok: false, error: bad }, 400);
    if (Object.keys(data).length === 0)
      return json({ ok: false, error: "EMPTY_PATCH" }, 400);

    const where: any = {
      id: { in: ids },
      products: { vendor_id: vendorId },
    };
    if (productId) where.product_id = productId;

    const res = await prisma.inventory_units.updateMany({ where, data });
    await logActivity({
      vendorId,
      actorUserId: gate.userId,
      action: "unit.update",
      entityType: "product",
      entityId: productId ?? null,
      summary: `Updated ${res.count} inventory unit${res.count === 1 ? "" : "s"}`,
      meta: { count: res.count, fields: Object.keys(data) },
    });
    return json({ ok: true, count: res.count });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "UPDATE_FAILED" }, 500);
  }
}
