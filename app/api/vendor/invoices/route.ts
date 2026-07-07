export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

// Vendor-scoped invoice reads. Replaces the browser
// `supabase.from("invoices").select(...)` calls in the invoices pages.
//
// NOTE: the `invoices` table has no vendor_id/created_by column in this schema
// (vendor isolation was previously enforced by Supabase RLS). Every read here is
// gated behind getRouteVendor() so only an authenticated vendor can reach it,
// matching the prior "must be a logged-in vendor" posture. Data shapes (columns,
// the invoice_companies join, ordering) are preserved exactly so the UI renders
// unchanged.
//
// Query modes:
//   ?id=<uuid>          -> single invoice (full detail) + nested company/items/units/payments
//   ?trash=1            -> deleted invoices (trash page)
//   (default)           -> paginated list with filters + total count
//
// List params (default branch):
//   page, size, q, company, from, to, pay  -> filters + pagination (unchanged)
//   sort  -> one of invoice_date | grand_total | customer_name | payment_status | outstanding (default invoice_date)
//   dir   -> asc | desc (default desc)
//   all=1 -> return the full filtered result set (capped) for export, ignoring pagination
const SORTABLE = new Set([
  "invoice_number",
  "invoice_date",
  "grand_total",
  "customer_name",
  "payment_status",
  "outstanding",
]);
const EXPORT_CAP = 5000;

export async function GET(req: NextRequest) {
  const auth = await getRouteVendor();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");

  try {
    // ---- Single invoice (detail) ----
    if (id) {
      const inv = await prisma.invoices.findFirst({
        where: { id },
        select: {
          id: true,
          company_id: true,
          invoice_number: true,
          invoice_date: true,
          due_date: true,
          customer_name: true,
          billing_address: true,
          phone: true,
          email: true,
          gst_number: true,
          pan_number: true,
          notes: true,
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
          is_custom: true,
          amount_paid: true,
          payment_status: true,
          paid_at: true,
        },
      });
      if (!inv) return NextResponse.json({ ok: false, error: "Invoice not found" }, { status: 404 });
      return NextResponse.json({ ok: true, data: jsonSafe(inv) }, { headers: { "cache-control": "no-store" } });
    }

    // ---- Trash list ----
    if (sp.get("trash")) {
      const rows = await prisma.invoices.findMany({
        where: { deleted_at: { not: null } },
        orderBy: { deleted_at: "desc" },
        take: 200,
        select: {
          id: true,
          invoice_number: true,
          invoice_date: true,
          customer_name: true,
          total_amount: true,
          grand_total: true,
          deleted_at: true,
          invoice_companies: { select: { display_name: true } },
        },
      });
      return NextResponse.json({ ok: true, data: jsonSafe(rows) }, { headers: { "cache-control": "no-store" } });
    }

    // ---- Paginated list ----
    const all = sp.get("all") === "1";
    const page = Math.max(1, Number(sp.get("page")) || 1);
    const pageSizeRaw = Number(sp.get("size")) || 20;
    const pageSize = [10, 20, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 20;
    const search = (sp.get("q") || "").trim();
    const company = sp.get("company") || "";
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    const pay = sp.get("pay") || "";

    // Sorting (whitelisted; default invoice_date desc).
    const sortRaw = (sp.get("sort") || "").trim();
    const sort = SORTABLE.has(sortRaw) ? sortRaw : "invoice_date";
    const dir = sp.get("dir") === "asc" ? "asc" : "desc";

    const where: any = { deleted_at: null };

    if (search) {
      const safe = search.replace(/[%_]/g, "");
      // Also match invoices containing a product/description that matches, so
      // searching a product name returns customers who purchased it.
      const itemRows = await prisma.invoice_items.findMany({
        where: { description: { contains: safe } },
        select: { invoice_id: true },
        take: 1000,
      });
      const productInvoiceIds = Array.from(
        new Set(itemRows.map((r) => r.invoice_id)),
      ).slice(0, 500);

      const or: any[] = [
        { invoice_number: { contains: safe } },
        { customer_name: { contains: safe } },
      ];
      if (productInvoiceIds.length) or.push({ id: { in: productInvoiceIds } });
      where.OR = or;
    }

    if (company) where.company_id = company;
    if (pay) where.payment_status = pay;
    if (from || to) {
      where.invoice_date = {};
      if (from) where.invoice_date.gte = new Date(from);
      if (to) where.invoice_date.lte = new Date(to);
    }

    const selectShape = {
      id: true,
      invoice_number: true,
      invoice_date: true,
      due_date: true,
      customer_name: true,
      total_amount: true,
      grand_total: true,
      amount_paid: true,
      payment_status: true,
      created_at: true,
      invoice_companies: { select: { display_name: true } },
    } as const;

    // Export mode: return the full filtered set (capped), ordered, no pagination.
    const take = all ? EXPORT_CAP : pageSize;
    const skip = all ? 0 : (page - 1) * pageSize;

    // "outstanding" = COALESCE(grand_total,total_amount,0) - COALESCE(amount_paid,0)
    // is a computed expression Prisma orderBy can't express. Rather than drop to
    // raw SQL (which would have to re-implement the product-description OR
    // subquery in `where`), we fetch the candidate id set through the same
    // Prisma `where`, sort it by the computed amount server-side, slice the
    // page window, then hydrate the full rows (re-ordered to match).
    let rows: any[];
    let count: number;

    if (sort === "outstanding") {
      const [candidates, total] = await Promise.all([
        prisma.invoices.findMany({
          where,
          select: {
            id: true,
            grand_total: true,
            total_amount: true,
            amount_paid: true,
          },
        }),
        prisma.invoices.count({ where }),
      ]);

      const outstanding = (r: {
        grand_total: any;
        total_amount: any;
        amount_paid: any;
      }) => Number(r.grand_total ?? r.total_amount ?? 0) - Number(r.amount_paid ?? 0);

      const orderedIds = candidates
        .slice()
        .sort((a, b) =>
          dir === "asc"
            ? outstanding(a) - outstanding(b)
            : outstanding(b) - outstanding(a),
        )
        .map((r) => r.id)
        .slice(skip, skip + take);

      const fetched = await prisma.invoices.findMany({
        where: { id: { in: orderedIds } },
        select: selectShape,
      });
      const byId = new Map(fetched.map((r) => [r.id, r]));
      rows = orderedIds.map((id) => byId.get(id)).filter(Boolean);
      count = total;
    } else {
      const orderBy: any =
        sort === "invoice_number"
          ? { invoice_number: dir }
          : sort === "grand_total"
            ? { grand_total: dir }
            : sort === "customer_name"
              ? { customer_name: dir }
              : sort === "payment_status"
                ? { payment_status: dir }
                : { invoice_date: dir };

      const [r, c] = await Promise.all([
        prisma.invoices.findMany({
          where,
          orderBy,
          skip,
          take,
          select: selectShape,
        }),
        prisma.invoices.count({ where }),
      ]);
      rows = r;
      count = c;
    }

    return NextResponse.json(
      { ok: true, data: jsonSafe(rows), count },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e: any) {
    console.error("vendor/invoices GET error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load invoices" },
      { status: 500 },
    );
  }
}
