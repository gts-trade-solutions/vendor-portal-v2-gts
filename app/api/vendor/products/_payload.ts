import "server-only";

// Shared header-field mapper for the vendor product create/update endpoints.
// Takes the client payload (the exact object ProductEditor.save() builds) and
// returns a Prisma-safe `products` data object. Faithfully mirrors the original
// Supabase payload: same fields, same null handling, JSON columns, date coercion.
//
// NOTE: only header fields are mapped here. Media-derived columns
// (hero_image_path / og_image_path / video_path) are owned by the media endpoint.

function numOrNull(v: any): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: any): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length ? s : null;
}

// Supabase accepted "" / "YYYY-MM-DDTHH:mm" / null for timestamptz columns; Prisma
// needs a Date or null. Empty -> null; otherwise parse, falling back to null on
// an invalid date so we never throw on a malformed client value.
function dateOrNull(v: any): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(+d) ? null : d;
}

export function buildProductData(p: any): any {
  return {
    sku: strOrNull(p.sku),
    slug: String(p.slug ?? ""),
    name: String(p.name ?? ""),
    brand_id: p.brand_id || null,
    category_id: p.category_id || null,

    hsn: strOrNull(p.hsn),

    short_description: strOrNull(p.short_description),
    description: strOrNull(p.description),

    price: numOrNull(p.price),
    purchase_price: numOrNull(p.purchase_price) ?? 0,
    currency: p.currency || "INR",
    compare_at_price: numOrNull(p.compare_at_price),
    sale_price: numOrNull(p.sale_price),
    vendor_price: numOrNull(p.vendor_price),
    sale_starts_at: dateOrNull(p.sale_starts_at),
    sale_ends_at: dateOrNull(p.sale_ends_at),
    is_published: !!p.is_published,

    track_inventory: !!p.track_inventory,
    // NOTE: stock_qty is NOT written here — it is derived from inventory_units by
    // a DB trigger (trg_iu_stock_*) that keeps products.stock_qty = COUNT of
    // IN_STOCK units. The storefront reads stock_qty for availability, so a
    // manual value would drift / overwrite the real stock. Leave it trigger-owned.
    expiry_date: dateOrNull(p.expiry_date),

    made_in_korea: !!p.made_in_korea,
    is_vegetarian: !!p.is_vegetarian,
    cruelty_free: !!p.cruelty_free,
    toxin_free: !!p.toxin_free,
    paraben_free: !!p.paraben_free,

    meta_title: strOrNull(p.meta_title),
    meta_description: strOrNull(p.meta_description),
    ingredients_md: strOrNull(p.ingredients_md),
    key_features_md: strOrNull(p.key_features_md),
    additional_details_md: strOrNull(p.additional_details_md),

    // JSON columns (NOT NULL with defaults in schema) — always send a value.
    attributes: p.attributes ?? {},
    faq: Array.isArray(p.faq) ? p.faq : [],
    key_benefits: Array.isArray(p.key_benefits) ? p.key_benefits : [],
    // additional_details is a NOT NULL JSON column whose DB default isn't applied
    // on insert via Prisma — send {} explicitly or product create fails with a
    // "Null constraint violation on additional_details" error.
    additional_details: p.additional_details ?? {},

    volume_ml: numOrNull(p.volume_ml),
    net_weight_g: numOrNull(p.net_weight_g),
    country_of_origin: strOrNull(p.country_of_origin),
  };
}
