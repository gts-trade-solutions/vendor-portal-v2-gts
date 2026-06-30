export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

// Vendor-scoped read of invoice_addresses. Replaces browser
// `supabase.from("invoice_addresses").select(...)` reads on the addresses pages
// and the new-invoice page.
//
// SCOPING: in this app `invoice_addresses.vendor_id` stores the logged-in user's
// id (the existing pages filter `.eq("vendor_id", user.id)` and insert
// `vendor_id: user.id`). We replicate that exactly: scope by the caller's userId.
//
//   ?id=<uuid>  -> single address (still scoped to the caller; 404 otherwise)
//   (default)   -> all of this vendor's addresses, newest first
export async function GET(req: NextRequest) {
  const auth = await getRouteVendor();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");

  try {
    if (id) {
      const row = await prisma.invoice_addresses.findFirst({
        where: { id, vendor_id: auth.userId },
      });
      if (!row) return NextResponse.json({ ok: false, error: "Address not found" }, { status: 404 });
      return NextResponse.json({ ok: true, data: jsonSafe(row) }, { headers: { "cache-control": "no-store" } });
    }

    const rows = await prisma.invoice_addresses.findMany({
      where: { vendor_id: auth.userId },
      orderBy: { created_at: "desc" },
    });
    return NextResponse.json({ ok: true, data: jsonSafe(rows) }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    console.error("vendor/invoice-addresses GET error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load addresses" },
      { status: 500 },
    );
  }
}

// Create a bill-to address for the caller. Replaces the browser
// `supabase.from("invoice_addresses").insert(...)` on the new-address page.
// The owner is stamped server-side (vendor_id = caller's userId) — exactly the
// scope the GET reader filters by — so the client never supplies it.
export async function POST(req: NextRequest) {
  const auth = await getRouteVendor();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const str = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || null;
  };

  const label = str(body?.label);
  const address_line1 = str(body?.address_line1);
  const city = str(body?.city);
  const state = str(body?.state);
  const pincode = str(body?.pincode);

  if (!label) return NextResponse.json({ ok: false, error: "Label is required." }, { status: 400 });
  if (!address_line1)
    return NextResponse.json({ ok: false, error: "Address line 1 is required." }, { status: 400 });
  if (!city) return NextResponse.json({ ok: false, error: "City is required." }, { status: 400 });
  if (!state) return NextResponse.json({ ok: false, error: "State is required." }, { status: 400 });
  if (!pincode)
    return NextResponse.json({ ok: false, error: "Pincode is required." }, { status: 400 });

  try {
    const id = randomUUID();
    await prisma.invoice_addresses.create({
      data: {
        id,
        vendor_id: auth.userId,
        label,
        name: str(body?.name),
        phone: str(body?.phone),
        email: str(body?.email),
        gstin: str(body?.gstin),
        address_line1,
        address_line2: str(body?.address_line2),
        city,
        state,
        pincode,
        country: str(body?.country) || "India",
      },
    });
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    console.error("vendor/invoice-addresses POST error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to save address" },
      { status: 500 },
    );
  }
}

// Update one of the caller's bill-to addresses. Replaces the browser
// `supabase.from("invoice_addresses").update(...).eq("id", id)` on the edit page.
// Scoped to the caller's vendor_id (updateMany with the owner filter) so a user
// can't edit another vendor's address.
export async function PUT(req: NextRequest) {
  const auth = await getRouteVendor();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const str = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || null;
  };

  const label = str(body?.label);
  const address_line1 = str(body?.address_line1);
  const city = str(body?.city);
  const state = str(body?.state);
  const pincode = str(body?.pincode);

  if (!label) return NextResponse.json({ ok: false, error: "Label is required." }, { status: 400 });
  if (!address_line1)
    return NextResponse.json({ ok: false, error: "Address line 1 is required." }, { status: 400 });
  if (!city) return NextResponse.json({ ok: false, error: "City is required." }, { status: 400 });
  if (!state) return NextResponse.json({ ok: false, error: "State is required." }, { status: 400 });
  if (!pincode)
    return NextResponse.json({ ok: false, error: "Pincode is required." }, { status: 400 });

  try {
    await prisma.invoice_addresses.updateMany({
      where: { id, vendor_id: auth.userId },
      data: {
        label,
        name: str(body?.name),
        phone: str(body?.phone),
        email: str(body?.email),
        gstin: str(body?.gstin),
        address_line1,
        address_line2: str(body?.address_line2),
        city,
        state,
        pincode,
        country: str(body?.country) || "India",
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("vendor/invoice-addresses PUT error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to update address" },
      { status: 500 },
    );
  }
}

// Delete one of the caller's bill-to addresses. Replaces the browser
// `supabase.from("invoice_addresses").delete().eq("id", id)`. Scoped to the
// caller's vendor_id so a user can't delete another vendor's address.
export async function DELETE(req: NextRequest) {
  const auth = await getRouteVendor();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  try {
    await prisma.invoice_addresses.deleteMany({
      where: { id, vendor_id: auth.userId },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("vendor/invoice-addresses DELETE error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to delete address" },
      { status: 500 },
    );
  }
}
