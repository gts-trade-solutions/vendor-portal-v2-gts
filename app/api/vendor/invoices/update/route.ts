export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { recomputeInvoicePayment } from "@/lib/db/invoiceHelpers";
import { logActivity } from "@/lib/db/activityLog";

// Faithful port of the Postgres `update_invoice_atomic(p_invoice_id, payload)`
// RPC. Diffs the unit set (revert removed units to IN_STOCK, sell newly added
// ones), re-writes items + invoice_units, and patches the header with the RPC's
// exact coalesce semantics — all inside a single Prisma transaction. Owner/
// manager only. Payload shape: { header:{...}, items:[...], units:[...] }.
export async function POST(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  let p_invoice_id: string;
  let payload: any;
  try {
    const body = await req.json();
    p_invoice_id = body?.p_invoice_id;
    payload = body?.payload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const h = payload?.header || {};
  const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
  const units: any[] = Array.isArray(payload?.units) ? payload.units : [];
  const newIds: string[] = units.map((u) => u.unit_id);

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.invoices.findFirst({
        where: { id: p_invoice_id },
      });
      if (!existing) {
        throw new HttpError("Invoice not found");
      }

      const oldLinks = await tx.invoice_units.findMany({
        where: { invoice_id: p_invoice_id },
        select: { unit_id: true },
      });
      const oldIds = oldLinks.map((r) => r.unit_id);

      const newIdSet = new Set(newIds);
      const oldIdSet = new Set(oldIds);
      const removed = oldIds.filter((id) => !newIdSet.has(id));
      const added = newIds.filter((id) => !oldIdSet.has(id));

      if (added.length) {
        // Lock newly added units before validating/selling them.
        await tx.$queryRaw`SELECT id FROM inventory_units WHERE id IN (${Prisma.join(
          added,
        )}) FOR UPDATE`;

        // Not-available: not in stock AND not already sold to THIS invoice.
        const notAvailable = await tx.inventory_units.findMany({
          where: {
            id: { in: added },
            status: { not: "IN_STOCK" },
            NOT: { sold_invoice_id: p_invoice_id },
          },
          select: { unit_code: true },
          distinct: ["unit_code"],
        });
        if (notAvailable.length) {
          const codes = notAvailable.map((r) => r.unit_code).join(", ");
          throw new HttpError(`These units are not available: ${codes}`);
        }

        // Linked elsewhere: attached to a DIFFERENT invoice.
        const linkedElsewhere = await tx.invoice_units.findMany({
          where: {
            unit_id: { in: added },
            invoice_id: { not: p_invoice_id },
          },
          select: { unit_code: true },
        });
        if (linkedElsewhere.length) {
          const codes = linkedElsewhere.map((r) => r.unit_code).join(", ");
          throw new HttpError(
            `These units are linked to another invoice: ${codes}`,
          );
        }
      }

      if (removed.length) {
        await tx.inventory_units.updateMany({
          where: { id: { in: removed }, sold_invoice_id: p_invoice_id },
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
      }

      if (added.length) {
        await tx.inventory_units.updateMany({
          where: { id: { in: added }, status: "IN_STOCK" },
          data: {
            status: "SOLD",
            sold_at: new Date(),
            sold_invoice_id: p_invoice_id,
            updated_at: new Date(),
          },
        });
      }

      // Re-write invoice_units.
      await tx.invoice_units.deleteMany({
        where: { invoice_id: p_invoice_id },
      });
      if (newIds.length) {
        await tx.invoice_units.createMany({
          data: units.map((u) => ({
            id: randomUUID(),
            invoice_id: p_invoice_id,
            unit_id: u.unit_id,
            unit_code: u.unit_code,
            scan_code: u.scan_code || null,
            product_id: u.product_id,
          })),
        });
      }

      // Re-write invoice_items.
      await tx.invoice_items.deleteMany({
        where: { invoice_id: p_invoice_id },
      });
      if (items.length) {
        await tx.invoice_items.createMany({
          data: items.map((it, pos) => ({
            id: randomUUID(),
            invoice_id: p_invoice_id,
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

      // Header patch — replicate the RPC's coalesce semantics EXACTLY.
      //  - coalesce(new, existing): keep existing column when payload value is
      //    null/undefined/empty.
      //  - nullif(value, ''): overwrite unconditionally to value-or-null.
      //  - Number(value || 0): overwrite unconditionally.
      await tx.invoices.update({
        where: { id: p_invoice_id },
        data: {
          // coalesce-to-existing fields
          invoice_companies: {
            connect: { id: coalesce(h.company_id, existing.company_id) },
          },
          invoice_number: coalesce(h.invoice_number, existing.invoice_number),
          invoice_date: h.invoice_date
            ? new Date(h.invoice_date)
            : existing.invoice_date,
          customer_name: coalesce(h.customer_name, existing.customer_name),
          subtotal: coalesceNum(h.subtotal, existing.subtotal),
          discount_total: coalesceNum(h.discount_total, existing.discount_total),
          tax_type: coalesce(h.tax_type, existing.tax_type),
          grand_total: coalesceNum(h.grand_total, existing.grand_total),
          total_amount: coalesceNum(h.total_amount, existing.total_amount),
          is_custom:
            h.is_custom === null || h.is_custom === undefined
              ? existing.is_custom
              : !!h.is_custom,

          // nullif(value, '') — overwrite to value-or-null unconditionally
          due_date: h.due_date ? new Date(h.due_date) : null,
          billing_address: nullif(h.billing_address),
          bill_to_address_id: nullif(h.bill_to_address_id),
          phone: nullif(h.phone),
          email: nullif(h.email),
          gst_number: nullif(h.gst_number),
          pan_number: nullif(h.pan_number),
          notes: nullif(h.notes),

          // unconditional Number(value || 0)
          cgst_percent: Number(h.cgst_percent || 0),
          sgst_percent: Number(h.sgst_percent || 0),
          igst_percent: Number(h.igst_percent || 0),
          cgst_amount: Number(h.cgst_amount || 0),
          sgst_amount: Number(h.sgst_amount || 0),
          igst_amount: Number(h.igst_amount || 0),
          tax_amount: Number(h.tax_amount || 0),

          updated_at: new Date(),
        } as any,
      });

      // Port of the total-change trigger: re-roll payment_status/amount_paid
      // against the (possibly changed) grand_total so an edited invoice that
      // was PAID/PARTIAL stays consistent with its payment rows.
      await recomputeInvoicePayment(tx, p_invoice_id);
    });

    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "invoice.update",
      entityType: "invoice",
      entityId: p_invoice_id,
      summary: `Updated invoice ${h.invoice_number || ""}`.trim(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    console.error("vendor/invoices/update error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to update invoice" },
      { status: 500 },
    );
  }
}

// coalesce(new, existing): only take the new value when it is non-null,
// non-undefined and (for strings) non-empty; otherwise keep existing.
function coalesce<T>(value: any, existing: T): T {
  if (value === null || value === undefined) return existing;
  if (typeof value === "string" && value.trim() === "") return existing;
  return value as T;
}

// Numeric coalesce: keep existing column when the payload value is absent.
function coalesceNum(value: any, existing: any): any {
  if (value === null || value === undefined || value === "") return existing;
  return Number(value);
}

// nullif(value, ''): value-or-null.
function nullif(value: any): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s === "" ? null : s;
}

// Thrown to short-circuit the transaction with a 400-class validation message.
class HttpError extends Error {}
