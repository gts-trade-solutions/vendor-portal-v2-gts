export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

// Port of the `restore_invoice(invoice_id)` RPC. Brings a trashed invoice back:
// re-sells the units linked through invoice_units that are still IN_STOCK,
// reports how many were skipped (no longer available to re-sell), then clears
// the soft-delete flags. Owner/manager only.
//   body: { invoice_id }
export async function POST(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const invoiceId = String(body?.invoice_id || "").trim();
  if (!invoiceId) {
    return NextResponse.json({ ok: false, error: "invoice_id is required" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoices.findFirst({
        where: { id: invoiceId, deleted_at: { not: null } },
        select: { id: true },
      });
      if (!inv) return null; // signal "not in trash"

      const links = await tx.invoice_units.findMany({
        where: { invoice_id: invoiceId },
        select: { unit_id: true },
      });
      const linkedUnitIds = links.map((l) => l.unit_id);

      let restored = 0;
      if (linkedUnitIds.length) {
        const now = new Date();
        const res = await tx.inventory_units.updateMany({
          where: { status: "IN_STOCK", id: { in: linkedUnitIds } },
          data: {
            status: "SOLD",
            sold_at: now,
            sold_invoice_id: invoiceId,
            updated_at: now,
          },
        });
        restored = res.count;
      }

      // skipped = linked units NOT now SOLD against this invoice.
      let skipped = 0;
      if (linkedUnitIds.length) {
        skipped = await tx.inventory_units.count({
          where: {
            id: { in: linkedUnitIds },
            NOT: { status: "SOLD", sold_invoice_id: invoiceId },
          },
        });
      }

      await tx.invoices.update({
        where: { id: invoiceId },
        data: {
          deleted_at: null,
          deleted_by: null,
          updated_at: new Date(),
        },
      });

      return { restored, skipped };
    });

    if (result === null) {
      return NextResponse.json(
        { ok: false, error: "Invoice not found in trash" },
        { status: 400 },
      );
    }

    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "invoice.restore",
      entityType: "invoice",
      entityId: invoiceId,
      summary: "Restored invoice from trash",
      meta: result,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("vendor/invoices/restore POST error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to restore invoice" },
      { status: 500 },
    );
  }
}
