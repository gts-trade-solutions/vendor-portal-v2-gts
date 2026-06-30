import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/ses";
import { buildInvoiceEmail } from "@/lib/invoiceEmail";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const invoiceId = params.id;

    const body = await req.json().catch(() => ({}));
    const kind =
      body?.type === "reminder"
        ? "reminder"
        : body?.type === "warning"
          ? "warning"
          : "invoice";

    // --- auth: caller must be a logged-in vendor (NextAuth/MySQL). getRouteVendor
    // resolves the session user AND confirms they own/belong to a vendor, which
    // replaces the old Supabase bearer-token + vendors/vendor_members membership
    // check (any vendor member may send invoice emails / reminders). ---
    const ctx = await getRouteVendor();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- fetch invoice (Prisma) ---
    const invRow = await prisma.invoices.findFirst({ where: { id: invoiceId } });
    if (!invRow) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const inv = jsonSafe(invRow) as any;

    const to = (inv.email || "").trim();
    if (!to) {
      return NextResponse.json(
        { error: "This invoice has no customer email address." },
        { status: 400 },
      );
    }

    // --- throttle: at most one manual email per invoice per calendar day ---
    if (inv.last_email_at) {
      const last = new Date(inv.last_email_at);
      if (last.toDateString() === new Date().toDateString()) {
        return NextResponse.json(
          {
            error:
              "An email was already sent for this invoice today. Please try again tomorrow.",
          },
          { status: 429 },
        );
      }
    }

    const companyRow = inv.company_id
      ? await prisma.invoice_companies.findFirst({ where: { id: inv.company_id } })
      : null;
    const company = companyRow ? (jsonSafe(companyRow) as any) : null;

    const itemRows = await prisma.invoice_items.findMany({
      where: { invoice_id: invoiceId },
      orderBy: { position: "asc" },
    });
    const items = jsonSafe(itemRows) as any[];

    const { subject, html, text } = buildInvoiceEmail({
      invoice: inv,
      company: company ?? null,
      items: items ?? [],
      kind,
    });

    const messageId = await sendEmail({
      to,
      subject,
      html,
      text,
      replyTo: company?.email || undefined,
    });

    // record the send (only after success) so the daily throttle applies
    await prisma.invoices.update({
      where: { id: invoiceId },
      data: { last_email_at: new Date() },
    });

    return NextResponse.json({ ok: true, messageId, sentTo: to });
  } catch (e: any) {
    console.error("invoice email error", e);
    return NextResponse.json(
      { error: e?.message || "Failed to send email" },
      { status: 500 },
    );
  }
}
