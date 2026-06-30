export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getRouteUser } from "@/lib/auth/routeUser";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// POST /api/vendor/register — port of register_vendor(...).
// Caller must be LOGGED IN (NextAuth session) but is not yet a vendor, so we use
// getRouteUser() directly (NOT getRouteVendor). Creates a pending vendor for the
// caller and makes them the owner member.
//
// The register page sends p_-prefixed params; we accept those (and the bare
// names as a fallback).
export async function POST(req: Request) {
  const user = await getRouteUser();
  if (!user) return json({ ok: false, error: "Unauthorized" }, 401);
  const userId = user.id;

  try {
    const body = await req.json().catch(() => ({}));
    const display_name = String(body?.p_display_name ?? body?.display_name ?? "").trim();
    const legal_name = (body?.p_legal_name ?? body?.legal_name ?? null) as string | null;
    const slugInput = String(body?.p_slug ?? body?.slug ?? "").trim();
    const email = (body?.p_email ?? body?.email ?? null) as string | null;
    const phone = (body?.p_phone ?? body?.phone ?? null) as string | null;
    const gstin = (body?.p_gstin ?? body?.gstin ?? null) as string | null;
    const website = (body?.p_website ?? body?.website ?? null) as string | null;
    const address_json = body?.p_address_json ?? body?.address_json ?? null;

    // 1) Reject if this user already has a pending/approved vendor.
    const existing = await prisma.vendors.findFirst({
      where: { owner_profile_id: userId, status: { in: ["pending", "approved"] } },
    });
    if (existing) {
      return json(
        { ok: false, error: "You already have a vendor account (pending or approved)." },
        400,
      );
    }

    // 2) Resolve slug: use provided, else slugify display_name (fallback 'vendor').
    let slug = slugInput;
    if (!slug) {
      slug = display_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!slug) slug = "vendor";
    }
    // Ensure uniqueness: append -2, -3, … (matches the PG loop which starts i=2).
    const baseSlug = slug;
    let i = 2;
    while (await prisma.vendors.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${baseSlug}-${i}`;
      i += 1;
    }

    const vendor = await prisma.$transaction(async (tx) => {
      const created = await tx.vendors.create({
        data: {
          id: randomUUID(),
          owner_profile_id: userId,
          display_name,
          legal_name: legal_name || null,
          slug,
          email: email || null,
          phone: phone || null,
          gstin: gstin || null,
          website: website || null,
          address_json: address_json ?? undefined,
          status: "pending",
        },
      });

      // "on conflict do nothing" — make the owner an owner member.
      await tx.vendor_members.upsert({
        where: { vendor_id_user_id: { vendor_id: created.id, user_id: userId } },
        create: { vendor_id: created.id, user_id: userId, role: "owner" },
        update: {},
      });

      return created;
    });

    return json({ ok: true, data: jsonSafe(vendor) });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "WRITE_FAILED" }, 500);
  }
}
