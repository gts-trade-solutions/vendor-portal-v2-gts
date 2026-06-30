export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { revertInvoiceUnits } from "@/lib/db/invoiceHelpers";
import { logActivity } from "@/lib/db/activityLog";

// Port of the `purge_invoice(invoice_id)` RPC. Hard-deletes the invoice; child
// rows (invoice_items, invoice_units, invoice_payments, invoice_batch_items)
// fall away via their ON DELETE CASCADE FKs, exactly as in the DB. Owner/
// manager only.
//   ?id=<invoice uuid>   (also accepts { invoice_id } in a POST body)
// The DB has a BEFORE DELETE trigger (trg_revert_units_before_invoice_delete)
// that returns the invoice's units to stock; MySQL has no trigger, so we revert
// in-transaction before deleting. (Normally the units were already reverted at
// soft-delete time; this makes a direct purge safe too — and is idempotent.)
async function purge(invoiceId: string) {
  await prisma.$transaction(async (tx) => {
    await revertInvoiceUnits(tx, invoiceId);
    await tx.invoices.delete({ where: { id: invoiceId } });
  });
}

export async function DELETE(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  try {
    await purge(id);
    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "invoice.purge",
      entityType: "invoice",
      entityId: id,
      summary: "Permanently deleted invoice",
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("vendor/invoices/purge DELETE error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to delete invoice" },
      { status: 500 },
    );
  }
}

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
    await purge(invoiceId);
    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "invoice.purge",
      entityType: "invoice",
      entityId: invoiceId,
      summary: "Permanently deleted invoice",
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("vendor/invoices/purge POST error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to delete invoice" },
      { status: 500 },
    );
  }
}
