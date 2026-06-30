export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped product delete. Replaces the browser
// `supabase.from("products").delete().eq("id", id)` in the products page.
// Scoped via deleteMany on id + vendor_id so a vendor can only delete their own.
// product_images cascade on the FK (onDelete: Cascade).
export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json().catch(() => ({} as any));
    const id = String(body?.id || "");
    if (!id) return json({ ok: false, error: "MISSING_ID" }, 400);

    const res = await prisma.products.deleteMany({ where: { id, vendor_id: vendorId } });
    if (res.count === 0) return json({ ok: false, error: "NOT_FOUND" }, 404);
    await logActivity({
      vendorId,
      actorUserId: gate.userId,
      action: "product.delete",
      entityType: "product",
      entityId: id,
      summary: "Deleted product",
    });
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "DELETE_FAILED" }, 500);
  }
}
