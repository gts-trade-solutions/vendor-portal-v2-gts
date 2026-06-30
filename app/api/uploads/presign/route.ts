export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { STORAGE_BACKEND, resolveMediaUrl } from "@/lib/storage/backend";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";

// POST /api/uploads/presign  { bucket, key, contentType }
//
// Backend-aware upload broker for the vendor client uploaders (which cannot hold
// AWS creds). Re-implements the authz that Supabase Storage RLS provided. The
// vendor app has no "admin" — product buckets are gated by assertVendorWriter
// (owner/manager) instead of madenkorea's requireAdmin. madenkorea-only buckets
// (site-assets, product-story-media, facebook-media, review-media) are dropped.
//
// When STORAGE_BACKEND=s3 it returns an S3 presigned PUT URL the browser PUTs to.
// When STORAGE_BACKEND=supabase it returns { mode: "supabase" } so the client
// keeps its existing supabase-js .upload path (zero behavior change pre-flip).
const PRODUCT_BUCKETS = new Set(["product-media"]);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const bucket = String(body?.bucket || "");
  const key = String(body?.key || "").replace(/^\/+/, "");
  const contentType = String(body?.contentType || "application/octet-stream");

  if (!bucket || !key) {
    return NextResponse.json({ error: "bucket and key are required" }, { status: 400 });
  }
  if (!PRODUCT_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "unknown bucket" }, { status: 400 });
  }

  // Authz gate: only owner/manager vendors may write product media.
  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  // Key hardening: reject path-traversal / unsafe segments so a caller cannot
  // craft a key that escapes the bucket prefix or contains control characters.
  const badKey =
    key.includes("..") ||
    key.includes("\\") ||
    key.split("").some((c) => c.charCodeAt(0) < 32) ||
    key.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  if (badKey) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }
  // Only image/video content may be uploaded to the product-media bucket.
  if (!/^(image|video)\//i.test(contentType)) {
    return NextResponse.json(
      { error: "unsupported content type" },
      { status: 400 },
    );
  }

  // Pre-flip: keep the existing Supabase upload path on the client.
  if (STORAGE_BACKEND !== "s3") {
    return NextResponse.json({ mode: "supabase" });
  }

  const { presignPutUrl } = await import("@/lib/storage/s3");
  const s3Key = `${bucket}/${key}`;
  const uploadUrl = await presignPutUrl(s3Key, contentType);

  return NextResponse.json({
    mode: "s3",
    uploadUrl,
    key, // relative key — store in *_path columns exactly as before
    publicUrl: resolveMediaUrl(bucket, key), // full URL — store in *_url columns / preview
  });
}
