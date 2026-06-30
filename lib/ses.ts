// lib/ses.ts  (server-only)
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const region =
  process.env.AWS_REGION || process.env.AWS_SES_REGION || "ap-south-1";

const sesClient = new SESClient({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
}: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}) {
  const toAddresses = (Array.isArray(to) ? to : [to])
    .map((a) => a.trim())
    .filter(Boolean);

  if (toAddresses.length === 0) {
    throw new Error("No recipient email address provided");
  }

  const command = new SendEmailCommand({
    Source: process.env.AWS_FROM_EMAIL!,
    Destination: { ToAddresses: toAddresses },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Html: { Data: html, Charset: "UTF-8" },
        ...(text ? { Text: { Data: text, Charset: "UTF-8" } } : {}),
      },
    },
  });

  const res = await sesClient.send(command);
  return res.MessageId; // store this against recipient if needed
}
