import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { sendEmail } from "@/lib/ses";
import { buildInvoiceEmail } from "@/lib/invoiceEmail";
import { prisma } from "@/lib/db/prisma";
import { jsonSafe } from "@/lib/db/serialize";

export const runtime = "nodejs";

// Reminder cadence (days BEFORE due date) and the overdue warning day.
const REMINDER_DAYS = new Set([15, 7, 3, 2, 1]);
const WARNING_DAY = -1; // one day after due date -> single overdue warning

function daysUntil(dueYmd: string): number | null {
  const [y, m, d] = dueYmd.split("-").map(Number);
  if (!y || !m || !d) return null;
  const due = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86400000);
}

/**
 * Daily payment-reminder + overdue-warning job.
 *
 * For each unpaid invoice with a customer email and a due date:
 *   - sends a "reminder" at 15, 7, 3, 2 and 1 days before the due date
 *   - sends a single "overdue warning" 1 day after the due date
 * De-duplicated so at most one email goes out per invoice per day.
 *
 * Protect + schedule: set CRON_SECRET, then POST here daily with header
 * `x-cron-secret: <CRON_SECRET>`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret") || "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const lo = fmt(new Date(now.getTime() - 2 * 86400000)); // covers the -1 warning
  const hi = fmt(new Date(now.getTime() + 16 * 86400000)); // covers the 15-day reminder

  // Candidate unpaid invoices (Prisma). This is a server-side cron over ALL
  // vendors' invoices (gated by CRON_SECRET above), so no per-vendor scoping —
  // the original Supabase query was likewise global. Filters preserved exactly.
  let invs: any[];
  try {
    const rows = await prisma.invoices.findMany({
      where: {
        deleted_at: null,
        payment_status: { not: "PAID" },
        email: { not: null },
        due_date: { not: null, gte: new Date(lo), lte: new Date(hi) },
      },
    });
    invs = jsonSafe(rows) as any[];
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load invoices" }, { status: 500 });
  }

  let reminders = 0;
  let warnings = 0;
  const errors: string[] = [];

  for (const inv of invs || []) {
    try {
      const grand = Number(inv.grand_total ?? inv.total_amount ?? 0);
      const paid = Number(inv.amount_paid ?? 0);
      if (grand - paid <= 0) continue;

      // jsonSafe serializes the Date column to an ISO string; daysUntil expects
      // a YYYY-MM-DD, so slice off the time portion.
      const d = daysUntil(String(inv.due_date).slice(0, 10));
      if (d === null) continue;

      let kind: "reminder" | "warning" | null = null;
      if (REMINDER_DAYS.has(d)) kind = "reminder";
      else if (d === WARNING_DAY) kind = "warning";
      if (!kind) continue;

      // de-dupe: skip if we already emailed this invoice today
      if (inv.last_reminder_at) {
        const last = new Date(inv.last_reminder_at);
        if (last.toDateString() === now.toDateString()) continue;
      }

      const companyRow = inv.company_id
        ? await prisma.invoice_companies.findFirst({ where: { id: inv.company_id } })
        : null;
      const company = companyRow ? (jsonSafe(companyRow) as any) : null;

      const itemRows = await prisma.invoice_items.findMany({
        where: { invoice_id: inv.id },
        orderBy: { position: "asc" },
      });
      const items = jsonSafe(itemRows) as any[];

      const { subject, html, text } = buildInvoiceEmail({
        invoice: inv,
        company: company ?? null,
        items: items ?? [],
        kind,
      });

      await sendEmail({
        to: inv.email,
        subject,
        html,
        text,
        replyTo: company?.email || undefined,
      });

      await admin
        .from("invoices")
        .update({ last_reminder_at: new Date().toISOString() })
        .eq("id", inv.id);

      if (kind === "warning") warnings++;
      else reminders++;
    } catch (e: any) {
      errors.push(`${inv.invoice_number}: ${e?.message || "failed"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: (invs || []).length,
    reminders,
    warnings,
    errors,
  });
}
