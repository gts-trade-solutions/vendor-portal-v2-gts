export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

// Port of the `soft_delete_invoice(invoice_id)` RPC. Reverts every SOLD unit
// linked to the invoice back to IN_STOCK (the `revert_invoice_units` step),
// clears its sold metadata, then soft-deletes the invoice. Owner/manager only.
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
    const reverted = await prisma.$transaction(async (tx) => {
      // The set of units to revert: those sold directly against this invoice OR
      // linked through invoice_units. Mirrors revert_invoice_units' WHERE.
      const links = await tx.invoice_units.findMany({
        where: { invoice_id: invoiceId },
        select: { unit_id: true },
      });
      const linkedUnitIds = links.map((l) => l.unit_id);

      const now = new Date();
      const res = await tx.inventory_units.updateMany({
        where: {
          status: "SOLD",
          OR: [
            { sold_invoice_id: invoiceId },
            ...(linkedUnitIds.length ? [{ id: { in: linkedUnitIds } }] : []),
          ],
        },
        data: {
          status: "IN_STOCK",
          sold_at: null,
          sold_invoice_id: null,
          sold_customer_id: null,
          sold_customer_name: null,
          sold_customer_phone: null,
          sold_customer_email: null,
          sold_customer_address: null,
          updated_at: now,
        },
      });

      await tx.invoices.update({
        where: { id: invoiceId },
        data: {
          deleted_at: now,
          deleted_by: gate.userId,
          updated_at: now,
        },
      });

      return res.count;
    });

    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "invoice.trash",
      entityType: "invoice",
      entityId: invoiceId,
      summary: "Moved invoice to trash",
      meta: { reverted },
    });

    return NextResponse.json({ ok: true, reverted });
  } catch (e: any) {
    console.error("vendor/invoices/soft-delete POST error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to delete invoice" },
      { status: 500 },
    );
  }
}
