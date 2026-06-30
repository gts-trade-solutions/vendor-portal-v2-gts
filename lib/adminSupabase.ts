// lib/adminSupabase.ts
import { createClient } from "@supabase/supabase-js";

export const ADMIN_OWNER_ID =
  process.env.FB_OWNER_ID || process.env.INSTAGRAM_OWNER_ID || null;

export function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase URL or SERVICE_ROLE key missing in environment variables"
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
