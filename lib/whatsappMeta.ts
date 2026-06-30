// lib/whatsappMeta.ts

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v22.0";

export type MetaTemplateSendOptions = {
  toPhone: string;        // e.g. "+9198..." or "9198..."
  templateName: string;   // exact template name in Meta
  languageCode: string;   // e.g. "en_US"
  bodyVariables?: string[];
};

export type MetaTemplateSendResult =
  | { success: true; providerMessageId: string }
  | { success: false; error: string };

function normalizePhone(raw: string): string {
  // Meta sample uses digits only: "91744..."
  return (raw || "").replace(/[^\d]/g, "");
}

export async function sendWhatsAppTemplate(
  opts: MetaTemplateSendOptions
): Promise<MetaTemplateSendResult> {
  const { templateName, languageCode, bodyVariables = [] } = opts;
  const to = normalizePhone(opts.toPhone);

  const components =
    bodyVariables.length > 0
      ? [
          {
            type: "body",
            parameters: bodyVariables.map((val) => ({
              type: "text",
              text: val,
            })),
          },
        ]
      : [];

  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const payload: any = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  };

  if (components.length > 0) {
    payload.template.components = components;
  }

  console.log("WA DEBUG request =>", JSON.stringify(payload));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log("WA DEBUG response status:", res.status);
  console.log("WA DEBUG response body:", text);

  if (!res.ok) {
    return { success: false, error: text };
  }

  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    // ignore
  }

  const providerMessageId = data?.messages?.[0]?.id || "";

  if (!providerMessageId) {
    return {
      success: false,
      error: "No message id returned by Meta: " + text,
    };
  }

  return { success: true, providerMessageId };
}
