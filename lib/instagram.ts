// lib/instagram.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INSTAGRAM_OWNER_ID = process.env.INSTAGRAM_OWNER_ID!;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

export async function getActiveInstagramAccount() {
  const { data, error } = await supabaseAdmin
    .from("instagram_accounts")
    .select("*")
    .eq("owner_id", INSTAGRAM_OWNER_ID)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0] as {
    ig_business_account_id: string;
    username: string | null;
    access_token: string;
  };
}
