export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// The editable + read-only fields the settings page consumes.
const SELECT = {
  id: true,
  display_name: true,
  legal_name: true,
  slug: true,
  email: true,
  phone: true,
  gstin: true,
  website: true,
  address_json: true,
  expiry_alert_days: true,
  commission_rate: true,
  status: true,
  created_at: true,
} as const;

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Normalise an incoming address object to the {line1,line2,city,state,pincode,
// country} shape, dropping unknown keys. Returns null when nothing usable.
function normaliseAddress(input: any): Record<string, string> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const keys = ["line1", "line2", "city", "state", "pincode", "country"] as const;
  const out: Record<string, string> = {};
  let any = false;
  for (const k of keys) {
    const v = input[k];
    if (v != null && String(v).trim() !== "") {
      out[k] = String(v).trim();
      any = true;
    }
  }
  return any ? out : null;
}

// GET /api/vendor/profile — the caller's own vendor (editable + read-only fields).
export async function GET() {
  const ctx = await getRouteVendor();
  if (!ctx) return json({ ok: false, error: "Unauthorized" }, 401);

  const vendor = await prisma.vendors.findUnique({
    where: { id: ctx.vendor.id },
    select: SELECT,
  });
  if (!vendor) return json({ ok: false, error: "Vendor not found" }, 404);

  return json({ ok: true, data: jsonSafe(vendor), role: ctx.vendor.role });
}

// PUT /api/vendor/profile — owner/manager only. Updates editable fields.
// commission_rate / status / id / owner are never writable here.
export async function PUT(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json().catch(() => ({}));

    const display_name = String(body?.display_name ?? "").trim();
    if (!display_name) {
      return json({ ok: false, error: "Display name is required." }, 400);
    }

    // expiry_alert_days: positive int, clamped 1..3650.
    let expiry_alert_days: number | undefined = undefined;
    if (body?.expiry_alert_days != null && body.expiry_alert_days !== "") {
      const n = Math.floor(Number(body.expiry_alert_days));
      if (!Number.isFinite(n) || n < 1) {
        return json(
          { ok: false, error: "Expiry alert days must be a positive whole number." },
          400,
        );
      }
      expiry_alert_days = Math.min(3650, Math.max(1, n));
    }

    // Slug: if provided and changed, slugify + ensure uniqueness.
    let slug: string | undefined = undefined;
    if (body?.slug != null) {
      const requested = slugify(String(body.slug));
      const current = await prisma.vendors.findUnique({
        where: { id: vendorId },
        select: { slug: true },
      });
      if (requested && requested !== (current?.slug ?? "")) {
        // Reject if the slug is already taken by another vendor.
        const taken = await prisma.vendors.findUnique({
          where: { slug: requested },
          select: { id: true },
        });
        if (taken && taken.id !== vendorId) {
          return json(
            { ok: false, error: "That slug is already in use. Choose another." },
            409,
          );
        }
        slug = requested;
      }
    }

    const data: Record<string, any> = {
      display_name,
      legal_name: body?.legal_name ? String(body.legal_name).trim() : null,
      email: body?.email ? String(body.email).trim() : null,
      phone: body?.phone ? String(body.phone).trim() : null,
      gstin: body?.gstin ? String(body.gstin).trim() : null,
      website: body?.website ? String(body.website).trim() : null,
      updated_at: new Date(),
    };
    if (slug !== undefined) data.slug = slug;
    if (expiry_alert_days !== undefined) data.expiry_alert_days = expiry_alert_days;
    if ("address_json" in (body ?? {})) {
      const addr = normaliseAddress(body.address_json);
      data.address_json = addr ?? undefined;
      if (addr === null) data.address_json = null;
    }

    const updated = await prisma.vendors.update({
      where: { id: vendorId },
      data,
      select: SELECT,
    });

    await logActivity({
      vendorId,
      actorUserId: gate.userId,
      action: "profile.update",
      entityType: "vendor",
      entityId: vendorId,
      summary: "Updated vendor profile",
    });

    return json({ ok: true, data: jsonSafe(updated) });
  } catch (e: any) {
    // P2002 = unique constraint (slug race).
    if (e?.code === "P2002") {
      return json(
        { ok: false, error: "That slug is already in use. Choose another." },
        409,
      );
    }
    return json({ ok: false, error: e?.message || "WRITE_FAILED" }, 500);
  }
}
