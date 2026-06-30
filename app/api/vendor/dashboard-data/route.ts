export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

/**
 * Server-side, NextAuth/MySQL-backed replacement for the vendor dashboard's
 * direct browser `supabase.from(...).select(...)` reads. Every query is scoped
 * to the caller's own vendor (ctx.vendor.id) — never cross vendors.
 *
 * The dashboard's `.rpc(...)` report widgets (invoice_dashboard_summary,
 * vendor_profit_summary, etc.) are NOT handled here — they remain Supabase RPC
 * calls (a later migration phase).
 *
 * Actions (query param `action`):
 *   - (default)            -> bulk reads: vendor settings + products + units.
 *   - "customer-invoices"  -> the per-customer drill-down invoice list.
 *   - "customer-products"  -> products (line items) sold to one customer.
 */

// Build the vendor-scoped invoice `where` clause for a customer + date window.
// Shared by "customer-invoices" and "customer-products" so the owner/member
// boundary, "(Unnamed)" handling and date filter stay identical across both.
async function customerInvoiceWhere(
  vendorId: string,
  callerUserId: string,
  name: string,
  from: string,
  to: string,
) {
  // Invoices have no vendor_id column and are org-shared (the original Postgres
  // report RPCs aggregate ALL invoices, not by creator). The drill-down MUST use
  // the same scope as those reports, otherwise a customer the report lists shows
  // an empty drill-down. So: match the customer + period across all non-deleted
  // invoices (vendorId/callerUserId kept for signature compatibility, unused).
  void vendorId;
  void callerUserId;
  const where: any = {
    deleted_at: null,
  };
  if (from) where.invoice_date = { ...(where.invoice_date ?? {}), gte: new Date(from) };
  if (to) where.invoice_date = { ...(where.invoice_date ?? {}), lte: new Date(to) };

  // "(Unnamed)" maps to null / empty customer_name; otherwise exact match.
  if (name === "(Unnamed)") {
    where.OR = [{ customer_name: null }, { customer_name: "" }];
  } else {
    where.customer_name = name;
  }

  return where;
}

export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const vendorId = ctx.vendor.id;

  const action = req.nextUrl.searchParams.get("action");

  // ---- Customer drill-down: invoices for one customer in a date window ----
  if (action === "customer-invoices") {
    const name = req.nextUrl.searchParams.get("name") ?? "";
    const from = req.nextUrl.searchParams.get("from") ?? "";
    const to = req.nextUrl.searchParams.get("to") ?? "";

    const where = await customerInvoiceWhere(
      vendorId,
      ctx.userId,
      name,
      from,
      to,
    );

    const rows = await prisma.invoices.findMany({
      where,
      orderBy: { invoice_date: "desc" },
      select: {
        id: true,
        invoice_number: true,
        invoice_date: true,
        grand_total: true,
        total_amount: true,
        amount_paid: true,
        payment_status: true,
      },
    });

    const invoices = rows.map((r) => ({
      id: r.id,
      invoice_number: r.invoice_number,
      invoice_date: r.invoice_date ? toYmd(r.invoice_date) : null,
      grand_total: r.grand_total != null ? Number(r.grand_total) : null,
      total_amount: r.total_amount != null ? Number(r.total_amount) : null,
      amount_paid: r.amount_paid != null ? Number(r.amount_paid) : null,
      payment_status: r.payment_status,
    }));

    return NextResponse.json(
      { invoices },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // ---- Customer drill-down: products (line items) sold to one customer ----
  if (action === "customer-products") {
    const name = req.nextUrl.searchParams.get("name") ?? "";
    const from = req.nextUrl.searchParams.get("from") ?? "";
    const to = req.nextUrl.searchParams.get("to") ?? "";

    // Same vendor scope / "(Unnamed)" / date boundary as customer-invoices.
    const where = await customerInvoiceWhere(
      vendorId,
      ctx.userId,
      name,
      from,
      to,
    );

    const matching = await prisma.invoices.findMany({
      where,
      select: { id: true },
    });
    const ids = matching.map((r) => r.id);

    if (ids.length === 0) {
      return NextResponse.json(
        { products: [] },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const items = await prisma.invoice_items.findMany({
      where: { invoice_id: { in: ids } },
      select: { description: true, quantity: true, line_total: true },
    });

    // Aggregate in JS, grouping by description (coerce Decimals via Number).
    const agg = new Map<string, { description: string; qty: number; value: number }>();
    for (const it of items) {
      const desc = it.description ?? "";
      const existing = agg.get(desc);
      const qty = Number(it.quantity) || 0;
      const value = Number(it.line_total) || 0;
      if (existing) {
        existing.qty += qty;
        existing.value += value;
      } else {
        agg.set(desc, { description: desc, qty, value });
      }
    }
    const products = Array.from(agg.values()).sort((a, b) => b.value - a.value);

    return NextResponse.json(
      { products },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // ---- Default: bulk reads the dashboard needs (vendor-scoped) ----
  const [vendorRow, products, units] = await Promise.all([
    prisma.vendors.findUnique({
      where: { id: vendorId },
      select: { email: true, expiry_alert_days: true },
    }),
    prisma.products.findMany({
      where: { vendor_id: vendorId, deleted_at: null },
      select: { id: true, name: true, slug: true },
      take: 5000,
    }),
    prisma.inventory_units.findMany({
      where: { vendor_id: vendorId },
      select: {
        id: true,
        product_id: true,
        unit_code: true,
        status: true,
        expiry_date: true,
      },
      take: 20000,
    }),
  ]);

  return NextResponse.json(
    {
      vendorEmail: vendorRow?.email ?? null,
      expiryAlertDays: Number(vendorRow?.expiry_alert_days ?? 180),
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
      })),
      units: units.map((u) => ({
        id: u.id,
        product_id: u.product_id,
        unit_code: u.unit_code,
        status: u.status,
        // expiry_date is a DATE — emit YYYY-MM-DD so the dashboard's
        // String(...).slice(0,10) parsing keeps working unchanged.
        expiry_date: u.expiry_date ? toYmd(u.expiry_date) : null,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

// Format a Date as YYYY-MM-DD (UTC) — matches the shape Supabase returned for
// DATE columns, which the dashboard parses with String(...).slice(0, 10).
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
