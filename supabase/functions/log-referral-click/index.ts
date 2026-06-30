// supabase/functions/log-referral-click/index.ts
// Deno runtime

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { code, viewer_user_id = null, meta = {} } = await req.json();
    if (!code || typeof code !== "string") {
      return new Response(JSON.stringify({ error: "code required" }), { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      req.headers.get("cf-connecting-ip") ||
      "";
    const ua = req.headers.get("user-agent") || "";
    const referer = req.headers.get("referer") || "";

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await supabase.rpc("log_referral_click", {
      p_code: code,
      p_viewer_user: viewer_user_id,
      p_user_agent: ua,
      p_ip: ip,
      p_meta: { ...meta, referer }
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }

    return new Response(JSON.stringify({ ok: true, click_id: data }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `${e}` }), { status: 400 });
  }
});
