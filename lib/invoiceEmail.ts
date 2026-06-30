// lib/invoiceEmail.ts  (server-only) — builds invoice / payment-reminder emails.

type AnyRow = Record<string, any>;

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(v: unknown) {
  const n = Number(v);
  return inr.format(Number.isFinite(n) ? n : 0);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString("en-IN");
}

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildInvoiceEmail({
  invoice,
  company,
  items,
  kind,
}: {
  invoice: AnyRow;
  company: AnyRow | null;
  items: AnyRow[];
  kind: "invoice" | "reminder" | "warning";
}): { subject: string; html: string; text: string } {
  const sellerName = company?.display_name || "Made in Korea";
  const grandTotal = Number(invoice.grand_total ?? invoice.total_amount ?? 0);
  const amountPaid = Number(invoice.amount_paid ?? 0);
  const outstanding = Math.max(grandTotal - amountPaid, 0);

  const rows = (items || [])
    .map((it) => {
      const qty = Number(it.quantity ?? 0);
      const rate = Number(it.unit_price ?? 0);
      const disc = Number(it.discount ?? 0);
      const amount = Math.max(qty * rate - disc, 0);
      return `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(it.description)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${qty}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(rate)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(amount)}</td>
        </tr>`;
    })
    .join("");

  const bankBlock =
    company?.bank_name || company?.account_number
      ? `<div style="margin-top:16px;font-size:12px;color:#444">
           <strong>Bank Details</strong><br/>
           ${company?.bank_name ? `Bank: ${esc(company.bank_name)}<br/>` : ""}
           ${company?.account_number ? `A/C No: ${esc(company.account_number)}<br/>` : ""}
           ${company?.ifsc_code ? `IFSC: ${esc(company.ifsc_code)}<br/>` : ""}
         </div>`
      : "";

  const isReminder = kind === "reminder";
  const isWarning = kind === "warning";

  const heading = isWarning
    ? "Overdue Payment Notice"
    : isReminder
      ? "Payment Reminder"
      : `Invoice ${esc(invoice.invoice_number)}`;

  const intro = isWarning
    ? `<p>Dear ${esc(invoice.customer_name || "Customer")},</p>
       <p>Our records show invoice <strong>${esc(
         invoice.invoice_number,
       )}</strong> dated ${fmtDate(invoice.invoice_date)} is <strong>past its due date${
         invoice.due_date ? ` of ${fmtDate(invoice.due_date)}` : ""
       }</strong> and remains unpaid.</p>
       <p style="font-size:16px;color:#b91c1c"><strong>Amount overdue: ${money(outstanding)}</strong></p>
       <p>Please arrange payment at the earliest to avoid further action.</p>`
    : isReminder
      ? `<p>This is a friendly reminder regarding invoice <strong>${esc(
          invoice.invoice_number,
        )}</strong> dated ${fmtDate(invoice.invoice_date)}.${
          invoice.due_date ? ` Payment is due by <strong>${fmtDate(invoice.due_date)}</strong>.` : ""
        }</p>
       <p style="font-size:16px"><strong>Amount due: ${money(outstanding)}</strong></p>`
      : `<p>Dear ${esc(invoice.customer_name || "Customer")},</p>
       <p>Please find your invoice <strong>${esc(
         invoice.invoice_number,
       )}</strong> dated ${fmtDate(invoice.invoice_date)} below.</p>`;

  const totalsBlock = `
    <table style="width:100%;margin-top:12px;font-size:13px">
      <tr><td style="text-align:right;color:#555;padding:2px 8px">Invoice Total</td>
          <td style="text-align:right;width:140px;padding:2px 8px"><strong>${money(grandTotal)}</strong></td></tr>
      ${
        amountPaid > 0
          ? `<tr><td style="text-align:right;color:#555;padding:2px 8px">Paid</td>
                 <td style="text-align:right;padding:2px 8px">${money(amountPaid)}</td></tr>
             <tr><td style="text-align:right;color:#555;padding:2px 8px">Balance Due</td>
                 <td style="text-align:right;padding:2px 8px"><strong>${money(outstanding)}</strong></td></tr>`
          : ""
      }
    </table>`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#222">
    <h2 style="margin:0 0 4px">${esc(sellerName)}</h2>
    <h3 style="margin:0 0 12px;color:#555;font-weight:600">${heading}</h3>
    ${intro}
    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:6px 8px;text-align:left">Description</th>
          <th style="padding:6px 8px;text-align:right">Qty</th>
          <th style="padding:6px 8px;text-align:right">Rate</th>
          <th style="padding:6px 8px;text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:8px">No items</td></tr>`}</tbody>
    </table>
    ${totalsBlock}
    ${bankBlock}
    <p style="margin-top:18px;font-size:12px;color:#888">
      This is an automated email from ${esc(sellerName)}.
      ${company?.email ? `For queries, reply to ${esc(company.email)}.` : ""}
    </p>
  </div>`;

  const text = isWarning
    ? `OVERDUE: Invoice ${invoice.invoice_number} (${fmtDate(
        invoice.invoice_date,
      )}) is past due. Amount overdue: ${money(outstanding)}.`
    : isReminder
      ? `Payment reminder for invoice ${invoice.invoice_number} (${fmtDate(
          invoice.invoice_date,
        )}). Amount due: ${money(outstanding)}.`
      : `Invoice ${invoice.invoice_number} dated ${fmtDate(
          invoice.invoice_date,
        )}. Total: ${money(grandTotal)}${
          amountPaid > 0 ? `, Balance due: ${money(outstanding)}` : ""
        }.`;

  const subject = isWarning
    ? `OVERDUE: Invoice ${invoice.invoice_number} — ${money(outstanding)} past due`
    : isReminder
      ? `Payment reminder — Invoice ${invoice.invoice_number} (${money(outstanding)} due)`
      : `Invoice ${invoice.invoice_number} from ${sellerName}`;

  return { subject, html, text };
}
