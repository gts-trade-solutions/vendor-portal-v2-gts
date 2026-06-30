// Backend-aware media URL resolver — the single source of truth for turning a
// stored media path/URL into a public URL, under either storage backend.
//
// Strangler-fig: NEXT_PUBLIC_STORAGE_BACKEND = "supabase" (default) | "s3".
// Reversible by flipping the flag; no DB rewrite (S3 key = "<bucket>/<key>",
// identical to what the Supabase public URL concatenates after its host).
//
// Pure + isomorphic (no SDK) so it runs in client and server components alike.
// The normalizer is the tolerant logic previously duplicated in product.tsx
// (storagePublicUrl/reviewMediaUrl) and storyMediaUrl, so legacy mixed DB
// values (full /storage/v1/object/public/ URLs, bucket-prefixed keys) keep
// resolving under both backends.

const SUPABASE_MARKER = "/storage/v1/object/public/";

export type StorageBackend = "supabase" | "s3";

export const STORAGE_BACKEND: StorageBackend =
  process.env.NEXT_PUBLIC_STORAGE_BACKEND === "s3" ? "s3" : "supabase";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
// S3/CloudFront base (no trailing slash needed), e.g.
// https://madenkorea-media.s3.ap-south-1.amazonaws.com  or a CloudFront domain.
const MEDIA_CDN_URL = (process.env.NEXT_PUBLIC_MEDIA_CDN_URL || "").replace(/\/+$/, "");

/**
 * Recover the bare object key (no host, no bucket prefix) from any stored value:
 * a relative key, a bucket-prefixed key, or a full Supabase public URL.
 */
export function normalizeKey(bucket: string, rawPath: string): string {
  let v = rawPath.trim();
  const idx = v.indexOf(SUPABASE_MARKER);
  if (idx >= 0) {
    // ".../public/<bucket>/<key>" -> strip the marker and the first (bucket) segment
    const suffix = v.slice(idx + SUPABASE_MARKER.length);
    const firstSlash = suffix.indexOf("/");
    v = firstSlash >= 0 ? suffix.slice(firstSlash + 1) : suffix;
  }
  // strip leading slashes + a leading "<bucket>/" prefix if present
  v = v.replace(/^\/+/, "");
  if (v.startsWith(`${bucket}/`)) v = v.slice(bucket.length + 1);
  return v;
}

/**
 * Resolve a stored media path/URL to a public URL under the active backend.
 * - Falsy -> undefined.
 * - External absolute URL (NOT our Supabase storage host) -> passed through
 *   unchanged (Instagram/Facebook media, OAuth avatar pictures, etc.).
 * - Our storage (relative key OR a Supabase public URL) -> re-resolved to the
 *   active backend (Supabase public URL, or `${CDN}/<bucket>/<key>` for S3).
 */
export function resolveMediaUrl(bucket: string, rawPath?: string | null): string | undefined {
  if (!rawPath) return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;

  const isOurStorage = trimmed.includes(SUPABASE_MARKER);
  // External absolute URL (not our storage) -> leave as-is.
  if (!isOurStorage && /^https?:\/\//i.test(trimmed)) return trimmed;

  const key = normalizeKey(bucket, trimmed);
  if (!key) return undefined;

  if (STORAGE_BACKEND === "s3") {
    return MEDIA_CDN_URL ? `${MEDIA_CDN_URL}/${bucket}/${key}` : undefined;
  }
  return SUPABASE_URL ? `${SUPABASE_URL}${SUPABASE_MARKER}${bucket}/${key}` : undefined;
}
