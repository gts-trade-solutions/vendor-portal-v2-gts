export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import { prisma } from "@/lib/db/prisma";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped activity/audit-trail reader. Returns the caller's own vendor's
// log rows, newest first, paginated. Optional filters: action (exact),
// entity (entity_type exact), from/to (created_at range, inclusive-ish).
// Resolves actor emails/names from the user table in one batch. Owner/manager
// AND staff can all read here — the gate is just "is a vendor". (The viewer page
// itself restricts to owner/manager.)
export async function GET(req: NextRequest) {
  const ctx = await getRouteVendor();
  if (!ctx) return json({ ok: false, error: "Unauthorized" }, 401);

  const sp = req.nextUrl.searchParams;

  const limit = Math.min(200, Math.max(1, Math.floor(Number(sp.get("limit") || 50))));
  const offset = Math.max(0, Math.floor(Number(sp.get("offset") || 0)));

  const action = (sp.get("action") || "").trim();
  const entity = (sp.get("entity") || "").trim();
  const from = (sp.get("from") || "").trim();
  const to = (sp.get("to") || "").trim();

  const where: any = { vendor_id: ctx.vendor.id };
  if (action) where.action = action;
  if (entity) where.entity_type = entity;

  if (from || to) {
    const createdAt: any = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(+d)) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(+d)) {
        // If a bare date (no time) was provided, include the whole day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) d.setHours(23, 59, 59, 999);
        createdAt.lte = d;
      }
    }
    if (Object.keys(createdAt).length) where.created_at = createdAt;
  }

  try {
    const [rows, count] = await Promise.all([
      prisma.vendor_activity_log.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.vendor_activity_log.count({ where }),
    ]);

    // Resolve actor identities in one batch.
    const actorIds = Array.from(
      new Set(rows.map((r) => r.actor_user_id).filter((x): x is string => !!x)),
    );
    const users = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    const data = rows.map((r) => {
      const u = r.actor_user_id ? byId.get(r.actor_user_id) : undefined;
      return {
        id: r.id,
        vendor_id: r.vendor_id,
        actor_user_id: r.actor_user_id,
        // Prefer the stored actor_email, fall back to the looked-up one.
        actor_email: r.actor_email ?? u?.email ?? null,
        actor_name: u?.name ?? null,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        summary: r.summary,
        meta: r.meta ?? null,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      };
    });

    return json({ data, count });
  } catch (e: any) {
    console.error("vendor/activity GET error", e);
    return json({ ok: false, error: e?.message || "Failed to load activity" }, 500);
  }
}
