import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * MySQL port of Postgres RPC `allocate_order_units(p_order_id)`.
 *
 * Idempotent: for a paid order, allocates real inventory_units against each line
 * item up to its ordered quantity, filling only the remaining shortfall. Wrapped
 * in a single transaction; candidate units are locked with FOR UPDATE SKIP
 * LOCKED so concurrent callers (the API route + the reconcile cron) never grab
 * the same unit. Returns { ok, allocated } where allocated = units newly marked
 * SOLD. No-op (allocated:0) when the order is missing or not paid.
 *
 * Shared by POST /api/vendor/orders/allocate and the online reconcile cron.
 */
export async function allocateOrderUnits(
  orderId: string,
): Promise<{ ok: true; allocated: number }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.orders.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, paid_at: true, address_snapshot: true },
    });
    if (!order || order.status !== "paid") {
      return { ok: true, allocated: 0 };
    }

    const snap: any = order.address_snapshot ?? {};
    const name = snap?.name || null;
    const phone = snap?.phone || null;
    const email = snap?.email || null;
    const addr =
      [snap?.address, snap?.city, snap?.state, snap?.pincode]
        .filter(Boolean)
        .join(", ") || null;

    const grouped = await tx.order_items.groupBy({
      by: ["product_id"],
      where: { order_id: orderId },
      _sum: { quantity: true },
    });

    const soldAt = order.paid_at ?? new Date();
    let allocated = 0;

    for (const g of grouped) {
      const productId = g.product_id;
      if (!productId) continue;
      const qty = Number(g._sum.quantity ?? 0);
      if (qty <= 0) continue;

      // Products now own their stock directly: allocate units whose
      // product_id is the ordered product itself (no inventory_product_id
      // indirection).
      const already = await tx.inventory_units.count({
        where: { sold_order_id: orderId, product_id: productId },
      });

      const need = qty - already;
      if (need <= 0) continue;

      // need is a coerced integer (safe to interpolate as LIMIT). expiry FIFO,
      // nulls last. FOR UPDATE SKIP LOCKED for concurrency safety.
      const picked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM inventory_units
        WHERE product_id = ${productId}
          AND status = 'IN_STOCK'
        ORDER BY (expiry_date IS NULL), expiry_date ASC, created_at ASC
        LIMIT ${need}
        FOR UPDATE SKIP LOCKED
      `;
      const ids = picked.map((p) => p.id);
      if (ids.length === 0) continue;

      const res = await tx.inventory_units.updateMany({
        where: { id: { in: ids } },
        data: {
          status: "SOLD",
          sold_at: soldAt,
          sold_channel: "ONLINE",
          sold_order_id: orderId,
          sold_customer_name: name,
          sold_customer_phone: phone,
          sold_customer_email: email,
          sold_customer_address: addr,
          updated_at: new Date(),
        },
      });
      allocated += res.count;
    }

    return { ok: true, allocated };
  });
}
