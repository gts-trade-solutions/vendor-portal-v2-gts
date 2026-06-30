export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { assertVendorAdmin } from "@/lib/auth/assertVendorAdmin";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

type MemberRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_owner: boolean;
};

// GET /api/vendor/team — port of list_vendor_members().
// Returns the owner row first, then member rows (excluding the owner),
// ordered by full_name (nulls last). Columns: user_id, email, full_name,
// role, is_owner.
export async function GET() {
  const gate = await assertVendorAdmin();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const vendor = await prisma.vendors.findUnique({
      where: { id: vendorId },
      select: { owner_profile_id: true },
    });
    if (!vendor) return json({ ok: false, error: "Not allowed" }, 403);
    const ownerId = vendor.owner_profile_id;

    // member rows (everyone except the owner)
    const memberLinks = await prisma.vendor_members.findMany({
      where: { vendor_id: vendorId, user_id: { not: ownerId } },
      select: { user_id: true, role: true },
    });

    // gather every user_id we need identity info for (owner + members)
    const ids = Array.from(new Set([ownerId, ...memberLinks.map((m) => m.user_id)]));

    const [users, profs] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
      prisma.profiles.findMany({ where: { id: { in: ids } }, select: { id: true, full_name: true } }),
    ]);
    const emailById = new Map(users.map((u) => [u.id, u.email ?? null]));
    const nameById = new Map(profs.map((p) => [p.id, p.full_name ?? null]));

    const ownerRow: MemberRow = {
      user_id: ownerId,
      email: emailById.get(ownerId) ?? null,
      full_name: nameById.get(ownerId) ?? null,
      role: "owner",
      is_owner: true,
    };

    const memberRows: MemberRow[] = memberLinks.map((m) => ({
      user_id: m.user_id,
      email: emailById.get(m.user_id) ?? null,
      full_name: nameById.get(m.user_id) ?? null,
      role: m.role,
      is_owner: false,
    }));

    // order members by full_name (nulls last)
    memberRows.sort((a, b) => {
      if (a.full_name == null && b.full_name == null) return 0;
      if (a.full_name == null) return 1;
      if (b.full_name == null) return -1;
      return a.full_name.localeCompare(b.full_name);
    });

    return json({ ok: true, data: jsonSafe([ownerRow, ...memberRows]) });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "READ_FAILED" }, 500);
  }
}

// POST /api/vendor/team — port of add_vendor_member(email, role).
// Body: { email, role }. role must be manager|staff. The target must already
// be a registered user with a profile (signed in once). Upserts membership.
export async function POST(req: Request) {
  const gate = await assertVendorAdmin();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim();
    const role = String(body?.role ?? "");

    if (role !== "manager" && role !== "staff") {
      return json({ ok: false, error: "Role must be manager or staff" }, 400);
    }

    // Find the registered user. Emails are stored case-insensitively; fall back
    // to a lowercase match if the exact-trim lookup misses.
    let user = await prisma.user.findFirst({ where: { email } });
    if (!user && email) {
      user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    }
    if (!user) {
      return json(
        {
          ok: false,
          error:
            "No registered user with that email. Ask them to register and sign in once first.",
        },
        400,
      );
    }

    const profile = await prisma.profiles.findUnique({ where: { id: user.id } });
    if (!profile) {
      return json(
        {
          ok: false,
          error: "That user has not completed sign-in yet. Ask them to sign in once.",
        },
        400,
      );
    }

    await prisma.vendor_members.upsert({
      where: { vendor_id_user_id: { vendor_id: vendorId, user_id: user.id } },
      create: { vendor_id: vendorId, user_id: user.id, role },
      update: { role },
    });

    await logActivity({
      vendorId,
      actorUserId: gate.userId,
      action: "member.add",
      entityType: "member",
      entityId: user.id,
      summary: `Added ${email} as ${role}`,
      meta: { email, role },
    });

    return json({ ok: true, user_id: user.id, role });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "WRITE_FAILED" }, 500);
  }
}

// DELETE /api/vendor/team?user_id= — port of remove_vendor_member(user_id).
export async function DELETE(req: Request) {
  const gate = await assertVendorAdmin();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const userId = new URL(req.url).searchParams.get("user_id") || "";
    if (!userId) return json({ ok: false, error: "user_id is required" }, 400);

    await prisma.vendor_members.deleteMany({
      where: { vendor_id: vendorId, user_id: userId },
    });

    await logActivity({
      vendorId,
      actorUserId: gate.userId,
      action: "member.remove",
      entityType: "member",
      entityId: userId,
      summary: "Removed a team member",
    });

    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "WRITE_FAILED" }, 500);
  }
}
