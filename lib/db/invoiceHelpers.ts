import "server-only";
import { Prisma } from "@prisma/client";

// Shared ports of the Postgres invoice triggers/functions that MySQL does NOT
// replicate (MySQL has no triggers here). Call these from the create / update /
// purge endpoints so behaviour matches the old SECURITY DEFINER RPCs exactly.

// Port of `set_invoice_number()` (BEFORE INSERT trigger). When the caller did
// not supply an invoice_number, generate `MK/YY/NNNNNN` from the next sequence
// value and set invoice_seq. We lock the current-max row FOR UPDATE so two
// concurrent creates can't collide on the same number. Returns the header
// fields to merge into the invoices.create data ({} when a number was given).
export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  provided?: string | null,
): Promise<{ invoice_number?: string; invoice_seq?: bigint }> {
  if (provided && provided.trim().length > 0) return {};
  // Lock the highest existing seq row; a concurrent generator blocks here until
  // we commit, so it then reads our freshly-inserted higher value.
  const rows = await tx.$queryRaw<{ invoice_seq: bigint | null }[]>`
    SELECT invoice_seq FROM invoices
    WHERE invoice_seq IS NOT NULL
    ORDER BY invoice_seq DESC LIMIT 1 FOR UPDATE`;
  const current = rows[0]?.invoice_seq ? Number(rows[0].invoice_seq) : 0;
  const next = current + 1;
  const yy = String(new Date().getFullYear()).slice(-2);
  return {
    invoice_number: `MK/${yy}/${String(next).padStart(6, "0")}`,
    invoice_seq: BigInt(next),
  };
}

// Port of `recompute_invoice_payment(p_invoice_id)` (the total/payment trigger).
// Rolls amount_paid / payment_status / paid_at up from the payment rows. Mirrors
// the SQL: <=0 UNPAID, >= total PAID (keeping the first paid_at), else PARTIAL.
export async function recomputeInvoicePayment(
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
  let status: "UNPAID" | "PARTIAL" | "PAID" = "UNPAID";
  if (amountPaid <= 0) status = "UNPAID";
  else if (Math.round(amountPaid * 100) >= Math.round(total * 100)) status = "PAID";
  else status = "PARTIAL";
  await tx.invoices.update({
    where: { id: invoiceId },
    data: {
      amount_paid: amountPaid,
      payment_status: status,
      paid_at: status === "PAID" ? inv?.paid_at ?? new Date() : null,
      updated_at: new Date(),
    },
  });
}

// Port of `revert_invoice_units(p_invoice_id)` (BEFORE DELETE trigger + the
// soft-delete helper). Un-sells the invoice's units back to IN_STOCK. Returns
// the count reverted.
export async function revertInvoiceUnits(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<number> {
  const linked = await tx.invoice_units.findMany({
    where: { invoice_id: invoiceId },
    select: { unit_id: true },
  });
  const linkedIds = linked.map((r) => r.unit_id);
  const res = await tx.inventory_units.updateMany({
    where: {
      status: "SOLD",
      OR: [{ sold_invoice_id: invoiceId }, { id: { in: linkedIds } }],
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
      updated_at: new Date(),
    },
  });
  return res.count;
}
