export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";
import { logActivity } from "@/lib/db/activityLog";

// Full editable column set returned by mode=full / mode=manage and the
// create/update mutators. (invoice_companies is ORG-SHARED — no vendor_id.)
const MANAGE_SELECT = {
  id: true,
  key: true,
  display_name: true,
  legal_name: true,
  address: true,
  gst_number: true,
  pan_number: true,
  phone: true,
  email: true,
  bank_name: true,
  bank_branch: true,
  account_number: true,
  ifsc_code: true,
  swift_code: true,
  upi_vpa: true,
  created_at: true,
} as const;

// Trim to a string or null. Required-field helpers use the non-null form.
const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

// slugify display_name -> a-z0-9 with single dashes, trimmed.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// Find a unique `key`, appending -2, -3, … if the base is taken. `ignoreId`
// lets an update keep its own key without colliding with itself.
async function uniqueKey(base: string, ignoreId?: string): Promise<string> {
  const root = slugify(base) || "company";
  let candidate = root;
  let n = 1;
  // Loop until no other row owns the candidate key.
  // (Small catalog; a handful of round-trips at worst.)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.invoice_companies.findFirst({
      where: { key: candidate, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
      select: { id: true },
    });
    if (!existing) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}

// Map an incoming body to the editable column set (key/display_name handled by
// the caller separately).
function editableFields(body: any) {
  return {
    legal_name: str(body?.legal_name),
    address: str(body?.address),
    gst_number: str(body?.gst_number),
    pan_number: str(body?.pan_number),
    phone: str(body?.phone),
    email: str(body?.email),
    bank_name: str(body?.bank_name),
    bank_branch: str(body?.bank_branch),
    account_number: str(body?.account_number),
    ifsc_code: str(body?.ifsc_code),
    swift_code: str(body?.swift_code),
    upi_vpa: str(body?.upi_vpa),
  };
}

// Vendor-scoped read of the (shared) invoice_companies catalog. Gated behind an
// authenticated vendor. Replaces browser `supabase.from("invoice_companies")`
// reads on the invoices list / new / edit / detail pages.
//
//   ?id=<uuid>             -> single company (full detail used by the invoice detail page)
//   ?mode=full|manage      -> all companies with the FULL editable column set
//                             (legal_name, pan_number, phone, bank*, upi_vpa)
//   (default)              -> all companies, ordered by display_name asc (slim set)
export async function GET(req: NextRequest) {
  const auth = await getRouteVendor();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  const mode = req.nextUrl.searchParams.get("mode");

  try {
    if (mode === "full" || mode === "manage") {
      const rows = await prisma.invoice_companies.findMany({
        orderBy: { display_name: "asc" },
        select: MANAGE_SELECT,
      });
      return NextResponse.json({ ok: true, data: jsonSafe(rows) }, { headers: { "cache-control": "no-store" } });
    }

    if (id) {
      const company = await prisma.invoice_companies.findFirst({
        where: { id },
        select: {
          id: true,
          display_name: true,
          address: true,
          gst_number: true,
          email: true,
          phone: true,
          bank_name: true,
          bank_branch: true,
          account_number: true,
          ifsc_code: true,
          swift_code: true,
          upi_vpa: true,
        },
      });
      return NextResponse.json({ ok: true, data: company }, { headers: { "cache-control": "no-store" } });
    }

    const rows = await prisma.invoice_companies.findMany({
      orderBy: { display_name: "asc" },
      select: {
        id: true,
        key: true,
        display_name: true,
        address: true,
        gst_number: true,
        email: true,
      },
    });
    return NextResponse.json({ ok: true, data: rows }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    console.error("vendor/invoice-companies GET error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load companies" },
      { status: 500 },
    );
  }
}

// Create a seller company (org-shared catalog). Owner/manager only.
// `display_name` required; `key` defaults to a unique slug of display_name.
export async function POST(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const display_name = str(body?.display_name);
  if (!display_name)
    return NextResponse.json({ ok: false, error: "Display name is required." }, { status: 400 });

  try {
    const requestedKey = str(body?.key);
    const key = await uniqueKey(requestedKey || display_name);

    const row = await prisma.invoice_companies.create({
      data: {
        id: randomUUID(),
        key,
        display_name,
        ...editableFields(body),
      },
      select: MANAGE_SELECT,
    });
    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "company.create",
      entityType: "company",
      entityId: row.id,
      summary: `Created company ${display_name}`,
    });
    return NextResponse.json({ ok: true, data: jsonSafe(row) });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "A company with that key already exists." },
        { status: 409 },
      );
    }
    console.error("vendor/invoice-companies POST error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to create company" },
      { status: 500 },
    );
  }
}

// Update a seller company. Owner/manager only. If `key` changes, keep it unique.
export async function PUT(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Partial update: only fields present in the body change (so a small patch
  // like {upi_vpa} won't blank the rest). display_name is optional on update
  // but cannot be set empty.
  if ("display_name" in body && !str(body.display_name))
    return NextResponse.json({ ok: false, error: "Display name cannot be empty." }, { status: 400 });

  try {
    const existing = await prisma.invoice_companies.findFirst({
      where: { id },
      select: { id: true, key: true },
    });
    if (!existing)
      return NextResponse.json({ ok: false, error: "Company not found." }, { status: 404 });

    const data: Record<string, any> = {};
    if ("display_name" in body) data.display_name = str(body.display_name);
    const requestedKey = str(body?.key);
    if (requestedKey && requestedKey !== existing.key) {
      data.key = await uniqueKey(requestedKey, id);
    }
    const EDITABLE = [
      "legal_name", "address", "gst_number", "pan_number", "phone", "email",
      "bank_name", "bank_branch", "account_number", "ifsc_code", "swift_code", "upi_vpa",
    ];
    for (const f of EDITABLE) if (f in body) data[f] = str((body as any)[f]);

    const row = await prisma.invoice_companies.update({
      where: { id },
      data,
      select: MANAGE_SELECT,
    });
    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "company.update",
      entityType: "company",
      entityId: id,
      summary: `Updated company ${row.display_name}`,
    });
    return NextResponse.json({ ok: true, data: jsonSafe(row) });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "A company with that key already exists." },
        { status: 409 },
      );
    }
    console.error("vendor/invoice-companies PUT error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to update company" },
      { status: 500 },
    );
  }
}

// Delete a seller company. Owner/manager only. Refused (409) when any invoice
// still references it, since invoices.company_id is a required FK.
export async function DELETE(req: NextRequest) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  try {
    const inUse = await prisma.invoices.count({ where: { company_id: id } });
    if (inUse > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `This company is used by ${inUse} invoice${inUse === 1 ? "" : "s"} and cannot be deleted.`,
        },
        { status: 409 },
      );
    }

    await prisma.invoice_companies.deleteMany({ where: { id } });
    await logActivity({
      vendorId: gate.vendor.id,
      actorUserId: gate.userId,
      action: "company.delete",
      entityType: "company",
      entityId: id,
      summary: "Deleted company",
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("vendor/invoice-companies DELETE error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to delete company" },
      { status: 500 },
    );
  }
}
