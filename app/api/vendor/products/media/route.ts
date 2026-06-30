export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";
import { prisma } from "@/lib/db/prisma";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Vendor-scoped product MEDIA writes. Replicates ProductEditor.save() steps after
// the files are uploaded (which now happens client-side via lib/storage/upload-client):
//   - delete removed product_images rows (by id, scoped to the product),
//   - upsert the surviving/new image rows (onConflict product_id,storage_path -> update alt/sort_order),
//   - recompute products.hero_image_path / og_image_path from sorted image rows,
//   - set or clear products.video_path.
// All writes run inside a single $transaction (the original did multiple dependent
// writes). Every row is scoped via the parent product's vendor_id so a vendor can
// never touch another vendor's media.
//
// Body:
//   { productId,
//     imgRows: [{ storage_path, alt, sort_order }],   // surviving + new images
//     toDeleteImgIds: string[],                        // product_images.id to remove
//     removeVideo?: boolean,
//     videoPath?: string | null }                      // new video path (when uploaded)
//
// Returns { ok, removedImagePaths, removedVideoPath } so the client can optionally
// delete those objects from storage (the "Delete files from storage on remove" toggle).
export async function POST(req: Request) {
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;
  const vendorId = gate.vendor.id;

  try {
    const body = await req.json().catch(() => ({} as any));
    const productId = String(body?.productId || "");
    if (!productId) return json({ ok: false, error: "MISSING_PRODUCT_ID" }, 400);

    const imgRows = (Array.isArray(body?.imgRows) ? body.imgRows : [])
      .map((r: any) => ({
        storage_path: String(r?.storage_path || ""),
        alt: r?.alt == null || r?.alt === "" ? null : String(r.alt),
        sort_order: Number.isFinite(Number(r?.sort_order)) ? Number(r.sort_order) : 0,
      }))
      .filter((r: any) => r.storage_path);

    const toDeleteImgIds: string[] = (Array.isArray(body?.toDeleteImgIds) ? body.toDeleteImgIds : [])
      .map((x: any) => String(x))
      .filter(Boolean);

    const removeVideo = !!body?.removeVideo;
    const videoPath: string | null =
      body?.videoPath == null || body?.videoPath === "" ? null : String(body.videoPath);

    // Confirm the product belongs to the caller's vendor before any media write.
    const product = await prisma.products.findFirst({
      where: { id: productId, vendor_id: vendorId },
      select: { id: true, video_path: true },
    });
    if (!product) return json({ ok: false, error: "PRODUCT_NOT_FOUND" }, 404);

    const result = await prisma.$transaction(async (tx) => {
      let removedImagePaths: string[] = [];

      // 1) Delete removed images (scoped to this product). Capture their
      //    storage_path first so the client can clean up storage if asked.
      if (toDeleteImgIds.length) {
        const gone = await tx.product_images.findMany({
          where: { id: { in: toDeleteImgIds }, product_id: productId },
          select: { storage_path: true },
        });
        removedImagePaths = gone.map((g) => g.storage_path).filter(Boolean);
        await tx.product_images.deleteMany({
          where: { id: { in: toDeleteImgIds }, product_id: productId },
        });
      }

      // 2) Upsert the surviving/new image rows. Emulates the original
      //    `.upsert(rows, { onConflict: "product_id,storage_path" })`:
      //    insert when new, update alt/sort_order when (product_id, storage_path) exists.
      for (const r of imgRows) {
        await tx.product_images.upsert({
          where: {
            product_id_storage_path: { product_id: productId, storage_path: r.storage_path },
          },
          create: {
            id: randomUUID(),
            product_id: productId,
            storage_path: r.storage_path,
            alt: r.alt,
            sort_order: r.sort_order,
          },
          update: { alt: r.alt, sort_order: r.sort_order },
        });
      }

      // 3) Video: clear or set. Mirrors the original two branches.
      let removedVideoPath: string | null = null;
      if (removeVideo) {
        removedVideoPath = product.video_path ?? null;
        await tx.products.updateMany({
          where: { id: productId, vendor_id: vendorId },
          data: { video_path: null },
        });
      } else if (videoPath) {
        await tx.products.updateMany({
          where: { id: productId, vendor_id: vendorId },
          data: { video_path: videoPath },
        });
      }

      // 4) Recompute hero/og from the sorted image rows (only when images supplied,
      //    matching the original `if (imgRows.length)` guard).
      if (imgRows.length) {
        const sorted = imgRows.slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const hero = sorted[0]?.storage_path ?? null;
        const og = sorted[1]?.storage_path ?? null;
        await tx.products.updateMany({
          where: { id: productId, vendor_id: vendorId },
          data: { hero_image_path: hero, og_image_path: og },
        });
      }

      return { removedImagePaths, removedVideoPath };
    });

    return json({ ok: true, ...result });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "MEDIA_WRITE_FAILED" }, 500);
  }
}
