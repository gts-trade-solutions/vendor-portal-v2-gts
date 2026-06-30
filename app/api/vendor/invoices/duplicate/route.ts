export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { nextInvoiceNumber } from "@/lib/db/invoiceHelpers";
import { logActivity } from "@/lib/db/activityLog";

// Duplicate an existing invoice into a fresh DRAFT. Copies the header fields and
// the line items only — NOT inventory units, payments, or email timestamps — so
// the user gets a clean, unpaid copy they can adjust and re-issue. Mirrors the
// data mapping of the create route. Owner/manager only.
//
// Accepts the source invoice id via ?id=<uuid> or a JSON body { id }.
export async function POST(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const ctx = gate;

  let id = req.nextUrl.searchParams.get("id") || "";
  if (!id) {
    try {
      const body = await req.json();
      id = String(body?.id || "").trim();
    } catch {
      // No body / invalid JSON — fall through to the missing-id check below.
    }
  }
  id = String(id || "").trim();
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing invoice id" },
      { status: 400 },
    );
  }

  try {
    const newId = await prisma.$transaction(async (tx) => {
      const src = await tx.invoices.findFirst({
        where: { id },
        select: {
          company_id: true,
          customer_name: true,
          billing_address: true,
          phone: true,
          email: true,
          contact_person: true,
          gst_number: true,
          pan_number: true,
          subtotal: true,
          discount_total: true,
          tax_type: true,
          cgst_percent: true,
          sgst_percent: true,
          igst_percent: true,
          cgst_amount: true,
          sgst_amount: true,
          igst_amount: true,
          tax_amount: true,
          grand_total: true,
          total_amount: true,
          notes: true,
          is_custom: true,
          bill_to_address_id: true,
        },
      });
      if (!src) throw new NotFoundError("Invoice not found");

      const srcItems = await tx.invoice_items.findMany({
        where: { invoice_id: id },
        orderBy: { position: "asc" },
        select: {
          product_id: true,
          brand: true,
          description: true,
          hsn: true,
          quantity: true,
          unit_price: true,
          discount: true,
          line_subtotal: true,
          line_total: true,
          position: true,
        },
      });

      const invoiceId = randomUUID();
      // Always generate a fresh number (pass no provided number).
      const num = await nextInvoiceNumber(tx);

      await tx.invoices.create({
        data: {
          id: invoiceId,
          invoice_companies: { connect: { id: src.company_id } },
          ...num,
          invoice_date: new Date(),
          due_date: null,
          status: "DRAFT",
          payment_status: "UNPAID",
          amount_paid: 0,
          paid_at: null,
          deleted_at: null,
          customer_name: src.customer_name,
          billing_address: src.billing_address,
          phone: src.phone,
          email: src.email,
          contact_person: src.contact_person,
          gst_number: src.gst_number,
          pan_number: src.pan_number,
          subtotal: src.subtotal,
          discount_total: src.discount_total,
          tax_type: src.tax_type,
          cgst_percent: src.cgst_percent,
          sgst_percent: src.sgst_percent,
          igst_percent: src.igst_percent,
          cgst_amount: src.cgst_amount,
          sgst_amount: src.sgst_amount,
          igst_amount: src.igst_amount,
          tax_amount: src.tax_amount,
          grand_total: src.grand_total,
          total_amount: src.total_amount,
          notes: src.notes,
          is_custom: src.is_custom,
          bill_to_address_id: src.bill_to_address_id,
          created_by: ctx.userId,
        } as any,
      });

      if (srcItems.length) {
        await tx.invoice_items.createMany({
          data: srcItems.map((it, pos) => ({
            id: randomUUID(),
            invoice_id: invoiceId,
            product_id: it.product_id,
            brand: it.brand,
            description: it.description,
            hsn: it.hsn,
            quantity: it.quantity,
            unit_price: it.unit_price,
            discount: it.discount,
            line_subtotal: it.line_subtotal,
            line_total: it.line_total,
            position: it.position ?? pos,
          })),
        });
      }

      return invoiceId;
    });

    await logActivity({
      vendorId: ctx.vendor.id,
      actorUserId: ctx.userId,
      action: "invoice.duplicate",
      entityType: "invoice",
      entityId: newId,
      summary: "Duplicated invoice",
      meta: { source_id: id },
    });

    return NextResponse.json({ ok: true, id: newId });
  } catch (e: any) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    console.error("vendor/invoices/duplicate error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to duplicate invoice" },
      { status: 500 },
    );
  }
}

class NotFoundError extends Error {}
