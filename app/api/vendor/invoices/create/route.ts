export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { nextInvoiceNumber } from "@/lib/db/invoiceHelpers";
import { logActivity } from "@/lib/db/activityLog";

// Faithful port of the Postgres `create_invoice_atomic(payload)` RPC.
// Header + items + units + inventory stock-status flip, all-or-nothing inside a
// single Prisma transaction. Owner/manager only (the `assert_invoice_writer`
// gate). Payload shape: { header:{...}, items:[...], units:[...] }.
export async function POST(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const ctx = gate;

  let payload: any;
  try {
    const body = await req.json();
    payload = body?.payload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const h = payload?.header;
  if (!h) {
    return NextResponse.json(
      { ok: false, error: "Missing invoice header" },
      { status: 400 },
    );
  }
  if (!String(h.customer_name || "").trim()) {
    return NextResponse.json(
      { ok: false, error: "Customer name is required" },
      { status: 400 },
    );
  }

  const items: any[] = Array.isArray(payload.items) ? payload.items : [];
  const units: any[] = Array.isArray(payload.units) ? payload.units : [];
  const unitIds: string[] = units.map((u) => u.unit_id);

  // Auto-numbered invoices can collide on the unique invoice_number under
  // concurrency (or on a fresh/empty table). Retry the whole transaction a few
  // times — nextInvoiceNumber() regenerates a fresh number each attempt — so a
  // collision never surfaces as a spurious 500. (Caller-supplied numbers are not
  // retried; a clash there is a real 409-class conflict.)
  const autoNumbered = !(h.invoice_number && String(h.invoice_number).trim());
  try {
    let result: { id: string } | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
    const result0 = await prisma.$transaction(async (tx) => {
      if (unitIds.length) {
        // Lock the candidate inventory units so a concurrent invoice can't
        // grab the same stock between our checks and the status flip.
        await tx.$queryRaw`SELECT id FROM inventory_units WHERE id IN (${Prisma.join(
          unitIds,
        )}) FOR UPDATE`;

        // Not-in-stock check.
        const notInStock = await tx.inventory_units.findMany({
          where: { id: { in: unitIds }, status: { not: "IN_STOCK" } },
          select: { unit_code: true },
          distinct: ["unit_code"],
        });
        if (notInStock.length) {
          const codes = notInStock.map((r) => r.unit_code).join(", ");
          throw new HttpError(
            `These units are no longer in stock: ${codes}`,
          );
        }

        // Already-linked check.
        const linked = await tx.invoice_units.findMany({
          where: { unit_id: { in: unitIds } },
          select: { unit_code: true },
        });
        if (linked.length) {
          const codes = linked.map((r) => r.unit_code).join(", ");
          throw new HttpError(
            `These units are already linked to another invoice: ${codes}`,
          );
        }
      }

      const invoiceId = randomUUID();
      // Port of the set_invoice_number BEFORE INSERT trigger: auto-generate
      // MK/YY/NNNNNN + invoice_seq when the caller left the number blank.
      const num = await nextInvoiceNumber(tx, h.invoice_number);
      await tx.invoices.create({
        data: {
          id: invoiceId,
          invoice_companies: { connect: { id: h.company_id } },
          ...(h.invoice_number && String(h.invoice_number).trim()
            ? { invoice_number: String(h.invoice_number).trim() }
            : num),
          // No payments yet → recompute_invoice_payment result is UNPAID/0.
          payment_status: "UNPAID",
          amount_paid: 0,
          invoice_date: h.invoice_date ? new Date(h.invoice_date) : new Date(),
          due_date: h.due_date ? new Date(h.due_date) : null,
          customer_name: h.customer_name,
          billing_address: h.billing_address || null,
          phone: h.phone || null,
          email: h.email || null,
          contact_person: h.contact_person || null,
          gst_number: h.gst_number || null,
          pan_number: h.pan_number || null,
          subtotal: Number(h.subtotal || 0),
          discount_total: Number(h.discount_total || 0),
          tax_type: h.tax_type || "CGST_SGST",
          cgst_percent: Number(h.cgst_percent || 0),
          sgst_percent: Number(h.sgst_percent || 0),
          igst_percent: Number(h.igst_percent || 0),
          cgst_amount: Number(h.cgst_amount || 0),
          sgst_amount: Number(h.sgst_amount || 0),
          igst_amount: Number(h.igst_amount || 0),
          tax_amount: Number(h.tax_amount || 0),
          grand_total: Number(h.grand_total || 0),
          total_amount: Number(h.total_amount || 0),
          notes: h.notes || null,
          status: h.status || "DRAFT",
          is_custom: !!h.is_custom,
          bill_to_address_id: h.bill_to_address_id || null,
          created_by: ctx.userId,
        } as any,
      });

      if (items.length) {
        await tx.invoice_items.createMany({
          data: items.map((it, pos) => ({
            id: randomUUID(),
            invoice_id: invoiceId,
            product_id: it.product_id || null,
            brand: it.brand || null,
            description: it.description || "",
            hsn: it.hsn || null,
            quantity: Number(it.quantity ?? 1),
            unit_price: Number(it.unit_price || 0),
            discount: Number(it.discount || 0),
            line_subtotal: Number(it.line_subtotal || 0),
            line_total: Number(it.line_total || 0),
            position: it.position ?? pos,
          })),
        });
      }

      if (unitIds.length) {
        await tx.invoice_units.createMany({
          data: units.map((u) => ({
            id: randomUUID(),
            invoice_id: invoiceId,
            unit_id: u.unit_id,
            unit_code: u.unit_code,
            scan_code: u.scan_code || null,
            product_id: u.product_id,
          })),
        });

        await tx.inventory_units.updateMany({
          where: { id: { in: unitIds }, status: "IN_STOCK" },
          data: {
            status: "SOLD",
            sold_at: new Date(),
            sold_invoice_id: invoiceId,
            updated_at: new Date(),
          },
        });
      }

      return { id: invoiceId };
    });
        result = result0;
        break;
      } catch (e: any) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002" &&
          autoNumbered &&
          attempt < 4
        ) {
          continue; // invoice_number collision — regenerate a number and retry
        }
        throw e;
      }
    }

    await logActivity({
      vendorId: ctx.vendor.id,
      actorUserId: ctx.userId,
      action: "invoice.create",
      entityType: "invoice",
      entityId: result!.id,
      summary: `Created invoice ${h.invoice_number || ""}`.trim(),
    });

    return NextResponse.json({ ok: true, id: result!.id });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    console.error("vendor/invoices/create error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to create invoice" },
      { status: 500 },
    );
  }
}

// Thrown to short-circuit the transaction with a 400-class validation message.
class HttpError extends Error {}
