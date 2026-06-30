export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { STORAGE_BACKEND } from "@/lib/storage/backend";
import { assertVendorWriter } from "@/lib/auth/assertVendorWriter";

// POST /api/uploads/delete  { bucket, key }
// Backend-aware delete broker (pairs with deleteMedia in lib/storage/upload-client).
// Same authz as the presign route: product buckets gated by assertVendorWriter
// (owner/manager). Under s3 it DeleteObjects server-side; under supabase it tells
// the client to .remove via its session client.
const PRODUCT_BUCKETS = new Set(["product-media"]);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const bucket = String(body?.bucket || "");
  const key = String(body?.key || "").replace(/^\/+/, "");

  if (!bucket || !key) return NextResponse.json({ error: "bucket and key are required" }, { status: 400 });
  if (!PRODUCT_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "unknown bucket" }, { status: 400 });
  }

  const gate = await assertVendorWriter();
  if (!gate.ok) return gate.response;

  if (STORAGE_BACKEND !== "s3") {
    return NextResponse.json({ mode: "supabase" });
  }

  const { s3Delete } = await import("@/lib/storage/s3");
  await s3Delete(`${bucket}/${key}`).catch(() => {});
  return NextResponse.json({ ok: true });
}
