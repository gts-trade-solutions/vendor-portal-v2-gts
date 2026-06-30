// supabase/functions/ses-webhook/index.ts
// Debug version with extra logging to trace why SES events are not updating the DB

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SnsMessageType =
  | "SubscriptionConfirmation"
  | "Notification"
  | "UnsubscribeConfirmation";

const DEBUG = true;

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// IMPORTANT: this must be the service role key from the SAME Supabase project
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Optional helper to log in a consistent way
function log(...args: any[]) {
  if (DEBUG) {
    console.log("[SES-WEBHOOK]", ...args);
  }
}

async function autoUnsubscribe(email: string, source: string) {
  try {
    log("Auto-unsubscribe:", email, "source:", source);
    const { error } = await supabase
      .from("email_unsubscribe")
      .upsert(
        { email, source },
        { onConflict: "email" },
      );

    if (error) {
      console.error("[SES-WEBHOOK] autoUnsubscribe error:", error);
    }
  } catch (err) {
    console.error("[SES-WEBHOOK] autoUnsubscribe unexpected error:", err);
  }
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  const bodyText = await req.text();
  log("Incoming request body:", bodyText);

  let message: any;
  try {
    message = JSON.parse(bodyText);
  } catch (err) {
    console.error("[SES-WEBHOOK] Invalid JSON body", err, bodyText);
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  const messageType = message.Type as SnsMessageType | undefined;
  log("message.Type =", messageType);

  // 1) SNS subscription confirmation
  if (messageType === "SubscriptionConfirmation") {
    const subscribeUrl = message.SubscribeURL as string | undefined;
    log("Handling SubscriptionConfirmation, URL:", subscribeUrl);
    if (subscribeUrl) {
      try {
        await fetch(subscribeUrl);
        log("Subscription confirmed.");
      } catch (err) {
        console.error("[SES-WEBHOOK] Failed to confirm SNS subscription:", err);
      }
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  // 2) Extract SES event:
  //    - If this is SNS (Type=Notification) with SES JSON in Message
  //    - Or direct SES HTTP / SNS raw event (no Type field)
  let sesEvent: any;

  if (messageType === "Notification" && typeof message.Message === "string") {
    log("Detected SNS envelope; parsing message.Message as SES event");
    try {
      sesEvent = JSON.parse(message.Message);
    } catch (err) {
      console.error(
        "[SES-WEBHOOK] Invalid SES event JSON inside SNS Message",
        err,
        message.Message,
      );
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Invalid SES JSON inside SNS Message",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }
  } else {
    log("No SNS envelope; treating body as SES event directly");
    sesEvent = message;
  }

  // 3) Get eventType and messageId from SES event
  const rawEventType = sesEvent.notificationType || sesEvent.eventType;
  const eventType =
    typeof rawEventType === "string" ? rawEventType.toLowerCase() : undefined;

  const mail = sesEvent.mail || {};
  const messageId = mail.messageId as string | undefined;
  const destination = (mail.destination || []) as string[];
  const firstEmail = destination.length > 0 ? destination[0] : undefined;

  log("Parsed SES eventType =", rawEventType, "->", eventType);
  log("SES mail.messageId =", messageId);
  log("SES mail.destination =", destination);

  if (!messageId || !eventType) {
    console.warn(
      "[SES-WEBHOOK] Missing messageId or eventType in SES event",
      {
        messageId,
        eventType,
        sesEvent,
      },
    );
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  const nowIso = new Date().toISOString();
  const updates: Record<string, any> = {};

  try {
    // 4) Map SES event types → email_campaign_recipient columns
    if (eventType === "delivery") {
      updates.delivery_event = "delivered";
      updates.delivery_event_at = nowIso;
      updates.delivery_event_payload = sesEvent;
      log("Mapped delivery event -> updates:", updates);
    } else if (eventType === "bounce") {
      updates.delivery_event = "bounce";
      updates.delivery_event_at = nowIso;
      updates.delivery_event_payload = sesEvent;
      log("Mapped bounce event -> updates:", updates);

      if (firstEmail) {
        await autoUnsubscribe(firstEmail.toLowerCase(), "ses_bounce");
      }
    } else if (eventType === "complaint") {
      updates.delivery_event = "complaint";
      updates.delivery_event_at = nowIso;
      updates.delivery_event_payload = sesEvent;
      log("Mapped complaint event -> updates:", updates);

      if (firstEmail) {
        await autoUnsubscribe(firstEmail.toLowerCase(), "ses_complaint");
      }
    } else if (eventType === "open") {
      updates.has_opened = true;
      updates.opened_at = nowIso;
      updates.last_engagement_payload = sesEvent;
      log("Mapped open event -> updates:", updates);
    } else if (eventType === "click") {
      updates.has_clicked = true;
      updates.clicked_at = nowIso;
      updates.last_engagement_payload = sesEvent;
      log("Mapped click event -> updates:", updates);
    } else {
      log("Unhandled eventType; storing in last_engagement_payload only");
      updates.last_engagement_payload = sesEvent;
    }

    if (!updates.last_engagement_payload) {
      updates.last_engagement_payload = sesEvent;
    }

    // 5) Apply updates and get row count back
    log("Running DB update with messageId =", messageId, "updates =", updates);

    const { data, error: updErr } = await supabase
      .from("email_campaign_recipient")
      .update(updates)
      .eq("ses_message_id", messageId)
      .select("id, ses_message_id");

    if (updErr) {
      console.error(
        "[SES-WEBHOOK] Failed to update email_campaign_recipient:",
        updErr,
      );
      return new Response(
        JSON.stringify({
          ok: false,
          error: "DB update error",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    log(
      "DB update complete. Updated rows count =",
      Array.isArray(data) ? data.length : 0,
      "rows:",
      data,
    );

    return new Response(JSON.stringify({ ok: true, updated: data?.length }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("[SES-WEBHOOK] Unexpected error handling SES event:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Unexpected error",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
