export function publicURL(bucket: string, path?: string | null) {
  if (!path) return undefined;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Supabase "public" URL pattern
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}
