export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped customers reads (display only). Replaces the browser
// `supabase.from("customers").select(...)` display calls on the units page.
//   - ?id=<customerId>  -> single customer (id,name,phone,email,address) for the view dialog
//   - ?q=<term>         -> up to 8 suggestions matching name/phone/email (sold-customer search)
// Both are constrained to ctx.vendor.id so a vendor never reads another
// vendor's customers. (The insert/dedupe lookups inside the SOLD/DEMO write
// flow remain on Supabase — writes are a later phase.)
export async function GET(req: Request) {
  const ctx = await getRouteVendor();
  if (!ctx) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const vendorId = ctx.vendor.id;

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      const row = await prisma.customers.findFirst({
        where: { id, vendor_id: vendorId },
        select: { id: true, name: true, phone: true, email: true, address: true },
      });
      return json({ ok: true, data: jsonSafe(row) });
    }

    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) return json({ ok: true, data: [] });
    const rows = await prisma.customers.findMany({
      where: {
        vendor_id: vendorId,
        OR: [
          { name: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } },
        ],
      },
      select: { id: true, name: true, phone: true, email: true, address: true },
      orderBy: { created_at: "desc" },
      take: 8,
    });
    return json({ ok: true, data: jsonSafe(rows) });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "READ_FAILED" }, 500);
  }
}

// Vendor-scoped customer resolve-or-create. Replaces the units page's
// `resolveOrCreateCustomer` inline Supabase flow (dedupe lookup by phone/email,
// then insert). Every read and the insert are stamped/scoped to ctx.vendor.id so
// a vendor can never see or create rows under another vendor.
//
// Body: { name, phone?, email?, address?, selectedId? }
// Returns { ok, id } — the resolved or newly-created customer id.
export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const phone = String(body?.phone ?? "").trim();
    const email = String(body?.email ?? "").trim();
    const address = String(body?.address ?? "").trim();
    const selectedId = body?.selectedId ? String(body.selectedId) : null;

    if (!name) return json({ ok: false, error: "Customer name is required" }, 400);

    // If an existing customer was chosen, just verify it belongs to this vendor.
    if (selectedId) {
      const found = await prisma.customers.findFirst({
        where: { id: selectedId, vendor_id: vendorId },
        select: { id: true },
      });
      if (found) return json({ ok: true, id: found.id });
    }

    // Dedupe by phone/email within this vendor (mirrors the page's .or lookup).
    if (phone || email) {
      const or: any[] = [];
      if (phone) or.push({ phone });
      if (email) or.push({ email });
      const existing = await prisma.customers.findFirst({
        where: { vendor_id: vendorId, OR: or },
        select: { id: true },
      });
      if (existing) return json({ ok: true, id: existing.id });
    }

    const id = randomUUID();
    await prisma.customers.create({
      data: {
        id,
        vendor_id: vendorId,
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
      },
    });
    return json({ ok: true, id });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "WRITE_FAILED" }, 500);
  }
}
