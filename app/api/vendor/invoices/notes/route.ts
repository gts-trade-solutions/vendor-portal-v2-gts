export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

// Update ONLY an invoice's `notes` field. A lightweight companion to the full
// update route so the invoice view page can edit the note inline without
// re-writing items/units (which would re-diff inventory and re-run the payment
// rollup). Owner/manager only (assert_invoice_writer), mirroring the payments
// route's gate — invoices carry no vendor_id, so there is no per-vendor scope to
// apply beyond the writer check.
//   body: { invoice_id, notes }
export async function POST(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const invoiceId = String(body?.invoice_id || "").trim();
  if (!invoiceId) {
    return NextResponse.json(
      { ok: false, error: "invoice_id is required" },
      { status: 400 },
    );
  }

  // Empty / whitespace-only clears the note (stored as NULL, same as the forms).
  const raw = body?.notes;
  const notes =
    raw === null || raw === undefined || String(raw).trim() === ""
      ? null
      : String(raw);

  try {
    const existing = await prisma.invoices.findUnique({
      where: { id: invoiceId },
      select: { id: true, invoice_number: true },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Invoice not found" },
        { status: 404 },
      );
    }

    await prisma.invoices.update({
      where: { id: invoiceId },
      data: { notes, updated_at: new Date() },
    });

    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "invoice.notes.update",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Edited notes on invoice ${existing.invoice_number || ""}`.trim(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("vendor/invoices/notes POST error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to update notes" },
      { status: 500 },
    );
  }
}
