export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

// Recompute an invoice's payment rollup from its payment rows, mirroring the
// Postgres `recompute_invoice_payment` side-effect that `add_invoice_payment` /
// `delete_invoice_payment` ran inside their function bodies. Keeps
// `amount_paid` / `payment_status` / `paid_at` consistent with the payments
// table so the invoice UI's Paid / Outstanding figures stay correct.
async function recomputeInvoicePayment(
  tx: Prisma.TransactionClient,
  invoiceId: string,
) {
  const agg = await tx.invoice_payments.aggregate({
    where: { invoice_id: invoiceId },
    _sum: { amount: true },
  });
  const amountPaid = Number(agg._sum.amount ?? 0);

  const inv = await tx.invoices.findUnique({
    where: { id: invoiceId },
    select: { grand_total: true, total_amount: true, paid_at: true },
  });
  const total = Number(inv?.grand_total ?? inv?.total_amount ?? 0);

  // Status mirrors recompute_invoice_payment: <=0 UNPAID, >= total PAID, else
  // PARTIAL. (Postgres uses exact numeric and no total>0 guard, so a 0-total
  // invoice with any payment is PAID — preserved here; tiny epsilon guards the
  // Decimal->Number float compare.)
  let status: "UNPAID" | "PARTIAL" | "PAID" = "UNPAID";
  if (amountPaid <= 0) status = "UNPAID";
  else if (Math.round(amountPaid * 100) >= Math.round(total * 100)) status = "PAID";
  else status = "PARTIAL";

  await tx.invoices.update({
    where: { id: invoiceId },
    data: {
      amount_paid: amountPaid,
      payment_status: status,
      // coalesce(paid_at, now()) when PAID — keep the first-paid timestamp,
      // clear it whenever the invoice is no longer fully paid.
      paid_at: status === "PAID" ? inv?.paid_at ?? new Date() : null,
      updated_at: new Date(),
    },
  });
}

// Port of the `add_invoice_payment(invoice_id, amount, method, reference, note,
// paid_at)` RPC. Records a payment then recomputes the invoice rollup. Caller
// must be a vendor owner/manager (assert_invoice_writer).
//   body: { invoice_id, amount, method?, reference?, note?, paid_at? }
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
  const amount = Number(body?.amount);
  if (!invoiceId) {
    return NextResponse.json({ ok: false, error: "invoice_id is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { ok: false, error: "Payment amount must be greater than zero" },
      { status: 400 },
    );
  }

  try {
    const id = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.invoice_payments.create({
        data: {
          id,
          invoice_id: invoiceId,
          amount,
          method: body?.method || null,
          reference: body?.reference || null,
          note: body?.note || null,
          paid_at: body?.paid_at ? new Date(body.paid_at) : new Date(),
          created_by: gate.userId,
        },
      });
      await recomputeInvoicePayment(tx, invoiceId);
    });
    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "payment.add",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Recorded payment of ${amount}`,
      meta: { payment_id: id, amount, method: body?.method || null },
    });
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    console.error("vendor/invoices/payments POST error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to record payment" },
      { status: 500 },
    );
  }
}

// Port of the `delete_invoice_payment(payment_id)` RPC. Removes a payment then
// recomputes the invoice rollup. Owner/manager only.
//   ?id=<payment uuid>
export async function DELETE(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  try {
    let deletedInvoiceId: string | null = null;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice_payments.findUnique({
        where: { id },
        select: { invoice_id: true },
      });
      if (!existing) return;
      await tx.invoice_payments.delete({ where: { id } });
      await recomputeInvoicePayment(tx, existing.invoice_id);
      deletedInvoiceId = existing.invoice_id;
    });
    if (deletedInvoiceId) {
      await logActivity({
        vendorId: gate.vendor.id,
        actorUserId: gate.userId,
        action: "payment.delete",
        entityType: "invoice",
        entityId: deletedInvoiceId,
        summary: "Removed a payment",
        meta: { payment_id: id },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("vendor/invoices/payments DELETE error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to remove payment" },
      { status: 500 },
    );
  }
}
