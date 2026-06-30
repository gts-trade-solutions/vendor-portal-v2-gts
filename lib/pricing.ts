// lib/pricing.ts
export function effectiveUnitPrice(p: {
  price: number | null;
  sale_price: number | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
}) {
  const now = Date.now();
  const withinSale =
    p.sale_price != null &&
    (!p.sale_starts_at || new Date(p.sale_starts_at).getTime() <= now) &&
    (!p.sale_ends_at || new Date(p.sale_ends_at).getTime() >= now);

  return withinSale ? Number(p.sale_price) : Number(p.price ?? 0);
}
