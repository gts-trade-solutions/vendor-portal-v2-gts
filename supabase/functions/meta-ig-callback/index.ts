// supabase/functions/meta-ig-callback/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // we’ll use this to know which user

  if (!code) {
    return new Response("Missing ?code", { status: 400 });
  }

  // 1) Decode state → should contain supabase user_id (or access token)
  // e.g. you can pass a JWT or simple user_id encrypted; for now assume raw user_id
  const userId = state; // in real code, validate/verify state!

  if (!userId) {
    return new Response("Missing state/userId", { status: 400 });
  }

  const clientId = Deno.env.get("META_IG_APP_ID")!;
  const clientSecret = Deno.env.get("META_IG_APP_SECRET")!;
  const graphBase = Deno.env.get("META_IG_GRAPH_API_BASE") ?? "https://graph.facebook.com";
  const version = Deno.env.get("META_IG_GRAPH_API_VERSION") ?? "v19.0";

  // Supabase admin client (service role)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // 2) Exchange code → short-lived token
    const tokenRes = await fetch(
      `${graphBase}/${version}/oauth/access_token` +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&client_secret=${encodeURIComponent(clientSecret)}` +
        `&redirect_uri=${encodeURIComponent(
          "https://" + url.host // edge function URL itself
        )}` +
        `&code=${encodeURIComponent(code)}`
    );
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error("Token exchange error:", tokenJson);
      return new Response("Failed to get access token", { status: 500 });
    }

    const accessToken = tokenJson.access_token as string;

    // 3) Optional: exchange for long-lived token
    const longRes = await fetch(
      `${graphBase}/${version}/oauth/access_token` +
        `?grant_type=fb_exchange_token` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&client_secret=${encodeURIComponent(clientSecret)}` +
        `&fb_exchange_token=${encodeURIComponent(accessToken)}`
    );
    const longJson = await longRes.json();
    const finalToken = longJson.access_token || accessToken;
    const expiresIn = longJson.expires_in || tokenJson.expires_in || null;
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    // 4) Find a Page with IG business account
    const pagesRes = await fetch(
      `${graphBase}/${version}/me/accounts?access_token=${encodeURIComponent(finalToken)}`
    );
    const pagesJson = await pagesRes.json();
    if (!pagesRes.ok) {
      console.error("Pages error:", pagesJson);
      return new Response("Failed to load pages", { status: 500 });
    }

    const pages = pagesJson.data || [];
    let chosenPage: any = null;
    let igBusinessId: string | null = null;

    for (const page of pages) {
      const pageDetailRes = await fetch(
        `${graphBase}/${version}/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(finalToken)}`
      );
      const pageDetailJson = await pageDetailRes.json();
      if (pageDetailJson.instagram_business_account?.id) {
        chosenPage = page;
        igBusinessId = pageDetailJson.instagram_business_account.id;
        break;
      }
    }

    if (!igBusinessId || !chosenPage) {
      return new Response("No IG business account linked", { status: 400 });
    }

    // 5) Get IG username
    const igRes = await fetch(
      `${graphBase}/${version}/${igBusinessId}?fields=username&access_token=${encodeURIComponent(finalToken)}`
    );
    const igJson = await igRes.json();
    if (!igRes.ok) {
      console.error("IG fetch error:", igJson);
      return new Response("Failed to load IG account", { status: 500 });
    }

    const username = igJson.username ?? null;

    // 6) Upsert into instagram_accounts using service role
    const { error: upsertErr } = await supabase
      .from("instagram_accounts")
      .upsert(
        {
          owner_id: userId,              // from state
          ig_business_account_id: igBusinessId,
          username,
          access_token: finalToken,
          token_expires_at: expiresAt,
          is_active: true,
          facebook_page_id: chosenPage.id,
          page_access_token: chosenPage.access_token,
        },
        { onConflict: "owner_id, ig_business_account_id" }
      );

    if (upsertErr) {
      console.error("Upsert error:", upsertErr);
      return new Response("DB error", { status: 500 });
    }

    // 7) Redirect back to your Next.js app
    const appUrl = new URL("http://localhost:3000/instagram/settings");
    appUrl.searchParams.set("connected", "1");

    return Response.redirect(appUrl.toString(), 302);
  } catch (err) {
    console.error("meta-ig-callback error:", err);
    const appUrl = new URL("http://localhost:3000/instagram/settings");
    appUrl.searchParams.set("error", "meta-callback");
    return Response.redirect(appUrl.toString(), 302);
  }
});
