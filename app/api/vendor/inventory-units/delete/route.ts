export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped inventory_units delete + optional audit. Replaces the browser
// `supabase.from("inventory_units").delete()` calls on the units page (single
// delete, single verified-override delete, and all three bulk-delete variants)
// plus the `inventory_units_bulk_delete_audit` inserts.
//
// EVERY delete is constrained to the caller's vendor via the products relation
// filter (products.vendor_id) AND the given product_id, so a vendor can never
// delete another vendor's units even by guessing ids.
//
// Body:
//   {
//     productId,
//     ids?: [],                 // SELECTED scope: explicit unit ids
//     filters?: {...},          // FILTERED scope: same params as the list reader
//     verifiedGuard?: boolean,  // SKIP_VERIFIED: only delete is_verified=false rows
//     audit?: {                 // optional bulk-delete-audit row (stamped vendor_id)
//       scope, total_units, verified_units, deleted_by_name,
//       is_admin_override, filters, selected_ids
//     }
//   }
//
// Returns { ok, count } where count is the number of rows actually deleted.

// Build the same filter `where` as the GET list reader so FILTERED-scope deletes
// match exactly what the table showed.
function buildFilterWhere(filters: any): any[] {
  const and: any[] = [];
  if (!filters || typeof filters !== "object") return and;

  const statusFilter = filters.statusFilter || "ALL";
  if (statusFilter !== "ALL") and.push({ status: statusFilter });

  const search = (filters.search || "").trim();
  if (search) {
    and.push({
      OR: [{ unit_code: { contains: search } }, { scan_code: { contains: search } }],
    });
  }

  const todayYmd = filters.today || new Date().toISOString().slice(0, 10);
  const today = new Date(todayYmd);
  const expiredFilter = filters.expiredFilter || "ALL";
  const includeNoExpiry = filters.includeNoExpiry !== false;

  if (expiredFilter === "EXPIRED") {
    and.push({ expiry_date: { not: null } });
    and.push({ expiry_date: { lt: today } });
  } else if (expiredFilter === "NOT_EXPIRED") {
    if (includeNoExpiry) {
      and.push({ OR: [{ expiry_date: null }, { expiry_date: { gte: today } }] });
    } else {
      and.push({ expiry_date: { gte: today } });
    }
  }

  if (filters.mfgFrom) and.push({ manufacture_date: { gte: new Date(filters.mfgFrom) } });
  if (filters.mfgTo) and.push({ manufacture_date: { lte: new Date(filters.mfgTo) } });

  if (filters.expFrom || filters.expTo) {
    if (!includeNoExpiry) {
      if (filters.expFrom) and.push({ expiry_date: { gte: new Date(filters.expFrom) } });
      if (filters.expTo) and.push({ expiry_date: { lte: new Date(filters.expTo) } });
    } else {
      const range: any = {};
      if (filters.expFrom) range.gte = new Date(filters.expFrom);
      if (filters.expTo) range.lte = new Date(filters.expTo);
      and.push({ OR: [{ expiry_date: null }, { expiry_date: range }] });
    }
  }

  return and;
}

export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json();
    const productId: string = String(body?.productId || "");
    if (!productId) return json({ ok: false, error: "MISSING_PRODUCT_ID" }, 400);

    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.map((x: any) => String(x)).filter(Boolean)
      : [];
    const usingIds = Array.isArray(body?.ids);
    const verifiedGuard = !!body?.verifiedGuard;

    // Base scope: caller's vendor (via products relation) + this product.
    const where: any = {
      product_id: productId,
      products: { vendor_id: vendorId },
    };

    if (usingIds) {
      if (ids.length === 0) return json({ ok: false, error: "NO_IDS" }, 400);
      where.id = { in: ids };
    } else {
      const and = buildFilterWhere(body?.filters);
      if (and.length) where.AND = and;
    }

    if (verifiedGuard) where.is_verified = false;

    const auditIn = body?.audit;

    const count = await prisma.$transaction(async (tx) => {
      const res = await tx.inventory_units.deleteMany({ where });

      if (auditIn && typeof auditIn === "object") {
        await tx.inventory_units_bulk_delete_audit.create({
          data: {
            id: randomUUID(),
            vendor_id: vendorId,
            product_id: productId,
            scope: String(auditIn.scope ?? "SELECTED"),
            total_units: Number(auditIn.total_units ?? 0),
            verified_units: Number(auditIn.verified_units ?? 0),
            deleted_units: res.count,
            skipped_verified_units: Number(auditIn.skipped_verified_units ?? 0),
            deleted_by_name: String(auditIn.deleted_by_name ?? "").trim() || "—",
            deleted_by_email: auditIn.deleted_by_email ?? null,
            deleted_by_user_id: gate.userId,
            is_admin_override: !!auditIn.is_admin_override,
            filters: auditIn.filters ?? null,
            selected_ids: auditIn.selected_ids ?? null,
          } as any,
        });
      }

      return res.count;
    });

    await logActivity({
      vendorId,
      actorUserId: gate.userId,
      action: "unit.delete",
      entityType: "product",
      entityId: productId,
      summary: `Deleted ${count} inventory unit${count === 1 ? "" : "s"}`,
      meta: { count },
    });

    return json({ ok: true, count });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "DELETE_FAILED" }, 500);
  }
}
