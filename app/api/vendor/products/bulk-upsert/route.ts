export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/db/activityLog";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped bulk product upsert. Replaces ProductForm.bulkUpsertAll()'s
// `supabase.from("products").upsert(..., { onConflict: "slug" })` +
// `supabase.from("product_images").upsert(..., { onConflict: "product_id,storage_path" })`.
//
// Faithfully mirrors the original logic:
//   - resolve brand_slug/category_slug -> ids (server-side maps),
//   - upsert each product by slug (insert when new, update when the slug already
//     belongs to THIS vendor),
//   - optionally clear+replace images (replaceImages flag),
//   - upsert gallery images (onConflict product_id,storage_path).
//
// Scoping: a product is only updated when its existing row has vendor_id = caller
// (or no vendor yet, which we then claim). A slug owned by ANOTHER vendor is
// rejected for that row so a vendor can never overwrite another vendor's product.
//
// Body: { products: BulkProductRow[], media: BulkMediaRow[], videos: BulkVideoRow[], replaceImages: boolean }
// Returns { ok, issues } (same issue-string shape the client renders).

function safeKeyPart(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function safeJSON(raw: any): any {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function dateOrNull(v: any): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(+d) ? null : d;
}

export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  const issues: string[] = [];
  let upserted = 0;
  try {
    const body = await req.json().catch(() => ({} as any));
    const products: any[] = Array.isArray(body?.products) ? body.products : [];
    const media: any[] = Array.isArray(body?.media) ? body.media : [];
    const videos: any[] = Array.isArray(body?.videos) ? body.videos : [];
    const replaceImages = !!body?.replaceImages;

    // 1) brand/category slug -> id maps
    const [catRows, brRows] = await Promise.all([
      prisma.categories.findMany({ select: { id: true, slug: true } }),
      prisma.brands.findMany({ select: { id: true, slug: true } }),
    ]);
    const catMap = new Map<string, string>(catRows.map((c) => [c.slug, c.id]));
    const brMap = new Map<string, string>(brRows.map((b) => [b.slug, b.id]));

    // 2) group media by sku
    const mediaBySku = new Map<string, any[]>();
    for (const m of media) {
      const sku = (m?.sku || "").trim();
      if (!sku || !m?.filename) continue;
      const arr = mediaBySku.get(sku) ?? [];
      arr.push(m);
      mediaBySku.set(sku, arr);
    }

    // 3) hero/og by sku (first two by sort_order)
    const heroOgBySku = new Map<string, { hero: string | null; og: string | null }>();
    for (const [sku, list] of Array.from(mediaBySku.entries())) {
      const sorted = list.slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const safeSku = safeKeyPart(sku);
      const hero = sorted[0] ? `${safeSku}/${safeKeyPart(sorted[0].filename)}` : null;
      const og = sorted[1] ? `${safeSku}/${safeKeyPart(sorted[1].filename)}` : null;
      heroOgBySku.set(sku, { hero, og });
    }

    // 4) video path by sku
    const videoPathBySku = new Map<string, string>();
    for (const v of videos) {
      const sku = (v?.sku || "").trim();
      if (!sku || !v?.filename) continue;
      videoPathBySku.set(sku, `${safeKeyPart(sku)}/video/${safeKeyPart(v.filename)}`);
    }

    // 5) per-product upsert
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const label = p.slug || p.sku || p.name || `(row#${i + 2})`;

      const category_id = p.category_slug ? catMap.get(p.category_slug) : undefined;
      const brand_id = p.brand_slug ? brMap.get(p.brand_slug) : undefined;
      if (!category_id) {
        issues.push(`'${label}': category '${p.category_slug}' not found`);
        continue;
      }
      if (!brand_id) {
        issues.push(`'${label}': brand '${p.brand_slug}' not found`);
        continue;
      }

      const skuKey = (p.sku || "").trim();
      const heroOg = heroOgBySku.get(skuKey) || { hero: null, og: null };

      const baseData: any = {
        sku: p.sku,
        name: p.name,
        brand_id,
        category_id,
        short_description: p.short_description ?? null,
        description: p.description ?? null,
        price: p.price ?? null,
        purchase_price: p.purchase_price ?? undefined,
        hsn: p.hsn ?? null,
        currency: p.currency ?? "INR",
        compare_at_price: p.compare_at_price ?? null,
        sale_price: p.sale_price ?? null,
        sale_starts_at: dateOrNull(p.sale_starts_at),
        sale_ends_at: dateOrNull(p.sale_ends_at),
        is_published: !!p.is_published,
        made_in_korea: !!p.made_in_korea,
        is_vegetarian: !!p.is_vegetarian,
        cruelty_free: !!p.cruelty_free,
        toxin_free: !!p.toxin_free,
        paraben_free: !!p.paraben_free,
        meta_title: p.meta_title ?? null,
        meta_description: p.meta_description ?? null,
        ingredients_md: p.ingredients_md ?? null,
        key_features_md: p.key_features_md ?? null,
        additional_details_md: p.additional_details_md ?? null,
        attributes: safeJSON(p.attributes_json) ?? {},
        faq: Array.isArray(p.faq) ? p.faq : [],
        key_benefits: Array.isArray(p.key_benefits) ? p.key_benefits : [],
        volume_ml: p.volume_ml ?? null,
        net_weight_g: p.net_weight_g ?? null,
        country_of_origin: p.country_of_origin ?? null,
      };

      // only touch media columns when this run supplied them (matches original)
      const imgsForSku = mediaBySku.get(skuKey);
      if (imgsForSku && imgsForSku.length) {
        baseData.hero_image_path = heroOg.hero ?? null;
        baseData.og_image_path = heroOg.og ?? null;
      }
      const video_path = videoPathBySku.get(skuKey);
      if (video_path) baseData.video_path = video_path;

      try {
        const product_id = await prisma.$transaction(async (tx) => {
          // Upsert by slug — but scoped: never overwrite another vendor's product.
          const existing = await tx.products.findUnique({
            where: { slug: p.slug },
            select: { id: true, vendor_id: true },
          });

          let pid: string;
          if (existing) {
            if (existing.vendor_id && existing.vendor_id !== vendorId) {
              throw new Error(`slug '${p.slug}' belongs to another vendor`);
            }
            await tx.products.update({
              where: { id: existing.id },
              data: { ...baseData, vendor_id: vendorId },
            });
            pid = existing.id;
          } else {
            const created = await tx.products.create({
              data: { id: randomUUID(), slug: p.slug, vendor_id: vendorId, ...baseData },
              select: { id: true },
            });
            pid = created.id;
          }

          if (replaceImages) {
            await tx.product_images.deleteMany({ where: { product_id: pid } });
          }

          const imgs = (mediaBySku.get(skuKey) || [])
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((m) => ({
              storage_path: `${safeKeyPart(skuKey)}/${safeKeyPart(m.filename)}`,
              alt: m.alt ?? null,
              sort_order: m.sort_order ?? 0,
            }));

          for (const im of imgs) {
            await tx.product_images.upsert({
              where: {
                product_id_storage_path: { product_id: pid, storage_path: im.storage_path },
              },
              create: {
                id: randomUUID(),
                product_id: pid,
                storage_path: im.storage_path,
                alt: im.alt,
                sort_order: im.sort_order,
              },
              update: { alt: im.alt, sort_order: im.sort_order },
            });
          }

          return pid;
        });
        void product_id;
        upserted += 1;
      } catch (e: any) {
        issues.push(`Upsert failed '${label}': ${e?.message ?? "unknown error"}`);
        continue;
      }
    }
  } catch (e: any) {
    issues.push(`Unexpected error: ${e?.message || String(e)}`);
  }

  if (upserted > 0) {
    await logActivity({
      vendorId,
      actorUserId: gate.userId,
      action: "product.bulk_upsert",
      entityType: "product",
      summary: `Imported/updated ${upserted} product${upserted === 1 ? "" : "s"}`,
      meta: { upserted, issues: issues.length },
    });
  }

  return json({ ok: issues.length === 0, issues });
}
