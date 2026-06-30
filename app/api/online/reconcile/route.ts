import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { allocateOrderUnits } from "@/lib/orders/allocateOrderUnits";

export const runtime = "nodejs";

/**
 * Safety-net reconciler for online stock sync. Re-runs allocation for recent
 * paid orders (idempotent — only fills the remaining shortfall), catching any
 * order the on-paid trigger missed. Schedule daily/hourly with header
 * `x-cron-secret: <CRON_SECRET>`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - 30 * 86400000);

  // Recent paid orders, read via Prisma (was supabase.from("orders").select("id")).
  // Same scope/filters: status = "paid" AND created_at >= since.
  let orders: { id: string }[];
  try {
    orders = await prisma.orders.findMany({
      where: { status: "paid", created_at: { gte: since } },
      select: { id: true },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load orders" },
      { status: 500 },
    );
  }

  let processed = 0;
  const errors: string[] = [];
  for (const o of orders || []) {
    try {
      await allocateOrderUnits(o.id);
      processed++;
    } catch (e: any) {
      errors.push(`${o.id}: ${e?.message || "allocation failed"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: (orders || []).length,
    processed,
    errors,
  });
}
