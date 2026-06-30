"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import "./page.css";

// ✅ Toastify (replace sonner)
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// ✅ PDF generation
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  UnitStatusBadge,
  type InventoryStatus,
} from "@/components/inventory/UnitStatusBadge";

import { UnitUpsertDialog } from "./UnitUpsert";
import { getInventoryCodeMode, getPublicScanCode } from "@/lib/inventoryUnitCodes";
import { useVendorRole } from "@/lib/hooks/useVendorRole";

/**
 * NOTE (DB):
 * If you want audit to store deleted_units + skipped_verified_units, run once:
 *
 * alter table public.inventory_units_bulk_delete_audit
 *   add column if not exists deleted_units int;
 *
 * alter table public.inventory_units_bulk_delete_audit
 *   add column if not exists skipped_verified_units int;
 */

type VendorInfo = {
  id: string;
  display_name: string;
  status: "pending" | "approved" | "rejected" | "disabled";
};

type InvoicePrintType = "CUSTOMER" | "ADMIN";

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  vendor_id: string;
  product_code: string | null;
  brand_id: string | null;
  sale_price: number | null;
};

type BrandRow = {
  id: string;
  name: string;
  brand_code: string | null;
};

type UnitRow = {
  id: string;
  unit_code: string;
  scan_code?: string | null;
  manufacture_date: string;
  expiry_date: string | null;
  status: InventoryStatus;
  created_at: string;
  price?: number | null;
  sold_customer_name?: string | null;
  sold_customer_phone?: string | null;
  sold_customer_id?: string | null;
  // ✅ verified lock
  is_verified?: boolean | null;
  verified_at?: string | null;
  demo_customer_name?: string | null;
  demo_customer_phone?: string | null;
  demo_customer_id?: string | null;
  demo_at?: string | null;
};

// NOTE: Destructive actions (verified-unit delete, status override, bulk
// delete) are authorized SERVER-SIDE via assertVendorWriter (owner/manager).
// The client only gates these behind an explicit typed/clicked confirmation.

function getVisibleUnitCode(unit?: { unit_code?: string | null; scan_code?: string | null } | null) {
  return getPublicScanCode(unit ?? null);
}

function isSharedScanUnit(unit?: { unit_code?: string | null; scan_code?: string | null } | null) {
  return getInventoryCodeMode(unit ?? null) === "shared_scan";
}

type InvoiceCompanyRow = {
  id: string;
  key: "GTS" | "NEMO" | "KORMART";
  display_name: string;
  legal_name: string | null;
  address: string | null;
  gst_number: string | null;
  pan_number: string | null;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  swift_code: string | null;
};

type InvoiceDraftItem = {
  id: string; // client id
  unit_id?: string; // optional tracking (not stored in DB)
  description: string;
  hsn_sac: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_percent: number;
};

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
};

function safe(s?: string | null) {
  return String(s ?? "").trim();
}

function wrapText(text: string, maxChars: number) {
  const t = safe(text);
  if (!t) return [""];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [t];
}

async function buildInvoicePdfLikeAttachment2(args: {
  company: InvoiceCompanyRow | null;
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  billingAddress: string;
  phone: string;
  email: string;
  customerGstin: string;
  customerPan: string;
  items: InvoiceDraftItem[];
  taxLabel: string;
  notes: string;
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  let y = height - margin;

  const line = (yy: number) => {
    page.drawLine({
      start: { x: margin, y: yy },
      end: { x: width - margin, y: yy },
      thickness: 1,
    });
  };

  const text = (
    t: string,
    x: number,
    yy: number,
    size = 10,
    isBold = false,
  ) => {
    page.drawText(safe(t), { x, y: yy, size, font: isBold ? bold : font });
  };

  // ---------- Calculate totals ----------
  let subtotal = 0;
  let taxTotal = 0;
  let grandTotal = 0;

  const rows = args.items.map((it) => {
    const qty = Math.max(1, Number(it.quantity || 1));
    const rate = Math.max(0, Number(it.unit_price || 0));
    const disc = Math.max(0, Number(it.discount || 0));
    const base = Math.max(qty * rate - disc, 0);
    const tax =
      Math.round(base * (Number(it.tax_percent || 0) / 100) * 100) / 100;
    const amount = base + tax;
    subtotal += base;
    taxTotal += tax;
    grandTotal += amount;
    return { ...it, qty, rate, disc, base, tax, amount };
  });

  subtotal = Math.round(subtotal * 100) / 100;
  taxTotal = Math.round(taxTotal * 100) / 100;
  grandTotal = Math.round(grandTotal * 100) / 100;

  // ---------- Header ----------
  const comp = args.company;

  text(
    safe(comp?.display_name || comp?.legal_name || "Company"),
    margin,
    y,
    13,
    true,
  );
  y -= 18;
  if (
    safe(comp?.legal_name) &&
    safe(comp?.legal_name) !== safe(comp?.display_name)
  ) {
    text(safe(comp?.legal_name), margin, y, 9, false);
    y -= 14;
  }
  if (safe(comp?.email)) {
    text(`Support Email: ${safe(comp?.email)}`, margin, y, 9, false);
    y -= 14;
  }
  text(`Contact: 9384857587, 9384857579, 9962110101`, margin, y, 9, false);
  y -= 14;

  // Right side header
  text("INVOICE", width - margin - 80, height - margin, 12, true);
  text(
    `Invoice No: ${args.invoiceNo}`,
    width - margin - 180,
    height - margin - 18,
    10,
    false,
  );
  text(
    `Invoice Date: ${args.invoiceDate}`,
    width - margin - 180,
    height - margin - 34,
    10,
    false,
  );

  // Divider
  y -= 8;
  line(y);
  y -= 24;

  // ---------- Bill To + Invoice Info ----------
  const leftX = margin;
  const rightX = width / 2 + 10;

  text("Bill To", leftX, y, 10, true);
  text("Invoice Info", rightX, y, 10, true);
  y -= 16;

  // Bill To details (left)
  const billLines: string[] = [];
  billLines.push(safe(args.customerName) || "-");
  if (safe(args.billingAddress))
    billLines.push(...wrapText(args.billingAddress, 42));
  if (safe(args.phone)) billLines.push(`Phone: ${safe(args.phone)}`);
  if (safe(args.customerGstin))
    billLines.push(`GSTIN: ${safe(args.customerGstin)}`);
  if (safe(args.customerPan)) billLines.push(`PAN: ${safe(args.customerPan)}`);

  let billY = y;
  for (const bl of billLines) {
    text(bl, leftX, billY, 9, false);
    billY -= 13;
  }

  // Invoice info (right)
  const infoLines: string[] = [];
  if (safe(args.email)) infoLines.push(`Customer Email: ${safe(args.email)}`);
  // if (safe(comp?.gst_number)) infoLines.push(`Seller GSTIN: ${safe(comp?.gst_number)}`);
  if (safe(comp?.pan_number))
    infoLines.push(`Seller PAN: ${safe(comp?.pan_number)}`);

  let infoY = y;
  for (const il of infoLines) {
    text(il, rightX, infoY, 9, false);
    infoY -= 13;
  }

  y = Math.min(billY, infoY) - 14;
  line(y);
  y -= 22;

  // ---------- Items Table ----------
  // Column layout (like your attachment)
  const tableX = margin;
  const tableW = width - margin * 2;

  const cols = {
    no: tableX + 0,
    desc: tableX + 30,
    hsn: tableX + 250,
    qty: tableX + 340,
    unit: tableX + 410,
    tax: tableX + 485,
    amt: tableX + 540,
  };

  // Header row (no fill, just bold)
  text("#", cols.no + 2, y, 9, true);
  text("Description", cols.desc, y, 9, true);
  text("HSN/SAC", cols.hsn, y, 9, true);
  text("Qty", cols.qty, y, 9, true);
  text("Unit Price", cols.unit, y, 9, true);
  text("Tax %", cols.tax, y, 9, true);
  text("Amount", cols.amt, y, 9, true);

  y -= 12;
  line(y);
  y -= 16;

  // Rows
  const rowGap = 14;
  rows.forEach((r, idx) => {
    // wrap description to 2 lines max
    const dLines = wrapText(r.description, 36).slice(0, 2);

    text(String(idx + 1), cols.no + 4, y, 9, false);
    text(dLines[0] || "", cols.desc, y, 9, false);
    if (dLines[1]) text(dLines[1], cols.desc, y - 12, 9, false);

    text(safe(r.hsn_sac || ""), cols.hsn, y, 9, false);
    text(String(r.qty), cols.qty, y, 9, false);
    text(money(r.rate), cols.unit, y, 9, false);
    text(money(Number(r.tax_percent || 0)), cols.tax, y, 9, false);
    text(money(r.amount), cols.amt, y, 9, false);

    // move y depending on wrapped line
    y -= dLines[1] ? rowGap + 12 : rowGap;

    // Stop if near bottom (simple guard)
    if (y < margin + 200) return;
  });

  y -= 8;
  line(y);
  y -= 18;

  // ---------- Totals (right aligned block) ----------
  const totalsX = width - margin - 170;
  const labelX = totalsX;
  const valX = width - margin;

  const rightText = (
    t: string,
    x: number,
    yy: number,
    size = 10,
    isBold = false,
  ) => {
    const w = (isBold ? bold : font).widthOfTextAtSize(t, size);
    page.drawText(t, { x: x - w, y: yy, size, font: isBold ? bold : font });
  };

  rightText("Subtotal", valX - 70, y, 10, false);
  rightText(money(subtotal), valX, y, 10, false);
  y -= 14;

  rightText(args.taxLabel || "Tax", valX - 70, y, 10, false);
  rightText(money(taxTotal), valX, y, 10, false);
  y -= 16;

  rightText("Total", valX - 70, y, 11, true);
  rightText(money(grandTotal), valX, y, 11, true);

  y -= 30;
  line(y);
  y -= 18;

  // ---------- Notes + Disclaimer + Return policy ----------
  text("Notes", margin, y, 10, true);
  y -= 14;

  const notesLines = wrapText(args.notes || "", 85);
  notesLines.slice(0, 4).forEach((nl) => {
    text(nl, margin, y, 9, false);
    y -= 13;
  });

  y -= 10;

  const disclaimer = [
    "Reseller Disclaimer",
    "We are resellers and are not responsible for product usage or handling guidance.",
    "For detailed information on how to use the product safely and effectively, please contact the product manufacturer directly.",
    "",
    "Return Policy",
    "• Returns are accepted within 5 days from the date of delivery.",
    "• Returns are only accepted for products with damaged packaging or expired items.",
    "• Used products or items with broken or tampered seals are not eligible for return.",
  ];

  disclaimer.forEach((dl, i) => {
    if (!dl) {
      y -= 8;
      return;
    }
    text(
      dl,
      margin,
      y,
      i === 0 || dl === "Return Policy" ? 9 : 8.8,
      i === 0 || dl === "Return Policy",
    );
    y -= 12.5;
  });

  return await pdfDoc.save();
}

// Vendor-scoped write/read endpoints (NextAuth-cookie authenticated).
async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { ok: res.ok && data?.ok, status: res.status, data };
}

function toYmd(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function money(n: any) {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function safeFileName(name: string) {
  return String(name || "invoice")
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 80);
}

// ✅ Reliable: download PDF without popups
function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ✅ Reliable: print PDF via hidden iframe (no blank popup)
function printPdfBytes(bytes: Uint8Array) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.src = url;

  document.body.appendChild(iframe);

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        URL.revokeObjectURL(url);
        iframe.remove();
      }, 1500);
    }
  };
}

type DraftInvoiceForPdf = {
  invoiceNumber: string;
  invoiceDate: string;

  companyName: string;
  companyAddress?: string;
  companyGst?: string;
  companyPan?: string;

  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  billingAddress?: string;

  taxLabel: string;
  notes?: string;

  items: Array<{
    description: string;
    hsn_sac?: string | null;
    quantity: number;
    unit_price: number;
    discount: number;
    tax_percent: number;
  }>;

  subtotal: number;
  tax: number;
  total: number;
};

// ✅ Simple A4 PDF matching your current fields (no popup HTML)
// ✅ Polished A4 PDF (table + borders + wrapping + pagination)
async function buildInvoicePdfFromDraft(d: DraftInvoiceForPdf) {
  const pdfDoc = await PDFDocument.create();

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const M = 40; // margin

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const fmtMoney = (n: any) => {
    const x = Number(n ?? 0);
    if (!Number.isFinite(x)) return "0.00";
    return x.toFixed(2);
  };

  const wrapText = (text: string, maxWidth: number, f: any, size: number) => {
    const words = String(text ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const lines: string[] = [];
    let cur = "";

    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      const width = f.widthOfTextAtSize(test, size);
      if (width <= maxWidth) cur = test;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };

  const drawBox = (
    page: any,
    x: number,
    y: number,
    w: number,
    h: number,
    opts?: { border?: boolean; borderWidth?: number },
  ) => {
    if (!opts?.border) return;

    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderWidth: opts.borderWidth ?? 1,
      // ✅ NO color / borderColor
    });
  };

  const drawText = (
    page: any,
    text: string,
    x: number,
    y: number,
    size: number,
    f: any,
    opts?: { maxWidth?: number },
  ) => {
    const s = String(text ?? "");
    if (!opts?.maxWidth) {
      page.drawText(s, { x, y, size, font: f, color: rgb(0.98, 0.98, 0.98) });
      return;
    }
    const lines = wrapText(s, opts.maxWidth, f, size);
    let yy = y;
    for (const line of lines) {
      page.drawText(line, {
        x,
        y: yy,
        size,
        font: f,
        color: rgb(0.98, 0.98, 0.98),
      });
      yy -= size + 2;
    }
  };

  // ---- Table columns (sum should fit within page width - margins) ----
  const tableX = M;
  const tableW = PAGE_W - M * 2;

  // Columns: # | Description | HSN | Qty | Rate | Disc | Tax% | Amount
  const COLS = [
    { key: "sn", w: 26, align: "left" as const },
    { key: "desc", w: 232, align: "left" as const },
    { key: "hsn", w: 54, align: "left" as const },
    { key: "qty", w: 34, align: "right" as const },
    { key: "rate", w: 58, align: "right" as const },
    { key: "disc", w: 56, align: "right" as const },
    { key: "tax", w: 44, align: "right" as const },
    { key: "amt", w: 76, align: "right" as const },
  ];
  const colSum = COLS.reduce((a, c) => a + c.w, 0);
  const scale = tableW / colSum;
  const cols = COLS.map((c) => ({ ...c, w: c.w * scale }));

  const headerFill = rgb(0.93, 0.93, 0.93);
  const borderColor = rgb(0.75, 0.75, 0.75);

  const makePage = () => pdfDoc.addPage([PAGE_W, PAGE_H]);

  let page = makePage();
  let y = PAGE_H - M;

  const drawTopHeader = () => {
    // Title
    page.drawText("TAX INVOICE", { x: M, y: y - 8, size: 18, font: bold });
    page.drawLine({
      start: { x: M, y: y - 14 },
      end: { x: PAGE_W - M, y: y - 14 },
      thickness: 1,
    });

    // Invoice meta (top-right)
    page.drawText(`Invoice No: ${d.invoiceNumber}`, {
      x: PAGE_W - M - 250,
      y: y - 6,
      size: 10,
      font,
    });
    page.drawText(`Invoice Date: ${d.invoiceDate}`, {
      x: PAGE_W - M - 250,
      y: y - 20,
      size: 10,
      font,
    });

    y -= 36;

    // Seller + Bill-to boxes
    const boxH = 92;
    const gap = 12;
    const boxW = (PAGE_W - M * 2 - gap) / 2;

    // Seller box
    drawBox(page, M, y - boxH, boxW, boxH, { border: true });
    page.drawText("Seller", { x: M + 10, y: y - 16, size: 11, font: bold });

    let sy = y - 32;
    drawText(page, d.companyName || "-", M + 10, sy, 10, bold, {
      maxWidth: boxW - 20,
    });
    sy -= 14;

    if (d.companyAddress) {
      drawText(page, d.companyAddress, M + 10, sy, 9, font, {
        maxWidth: boxW - 20,
      });
      // estimate lines used
      const lines = wrapText(d.companyAddress, boxW - 20, font, 9);
      sy -= lines.length * (9 + 2) + 4;
    }

    page.drawText(`GST: ${d.companyGst || "-"}`, {
      x: M + 10,
      y: sy,
      size: 9,
      font,
    });
    page.drawText(`PAN: ${d.companyPan || "-"}`, {
      x: M + 150,
      y: sy,
      size: 9,
      font,
    });

    // Bill-to box
    const bx = M + boxW + gap;
    drawBox(page, bx, y - boxH, boxW, boxH, { border: true });
    page.drawText("Bill To", { x: bx + 10, y: y - 16, size: 11, font: bold });

    let by = y - 32;
    drawText(page, d.customerName || "-", bx + 10, by, 10, bold, {
      maxWidth: boxW - 20,
    });
    by -= 14;

    if (d.billingAddress) {
      drawText(page, d.billingAddress, bx + 10, by, 9, font, {
        maxWidth: boxW - 20,
      });
      const lines = wrapText(d.billingAddress, boxW - 20, font, 9);
      by -= lines.length * (9 + 2) + 4;
    }

    page.drawText(`Phone: ${d.customerPhone || "-"}`, {
      x: bx + 10,
      y: by,
      size: 9,
      font,
    });
    page.drawText(`Email: ${d.customerEmail || "-"}`, {
      x: bx + 170,
      y: by,
      size: 9,
      font,
    });

    y -= boxH + 18;
  };

  const drawTableHeader = () => {
    const h = 22;
    drawBox(page, tableX, y - h, tableW, h, { fill: headerFill, border: true });

    let cx = tableX;
    const headers = [
      "#",
      "Description",
      "HSN",
      "Qty",
      "Rate",
      "Disc",
      "Tax%",
      "Amount",
    ];

    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      // vertical line
      if (i !== 0) {
        page.drawLine({
          start: { x: cx, y: y },
          end: { x: cx, y: y - h },
          thickness: 1,
        });
      }

      page.drawText(headers[i], {
        x: cx + 6,
        y: y - 15,
        size: 9,
        font: bold,
        color: rgb(0.98, 0.98, 0.98),
      });

      cx += col.w;
    }

    y -= h;
  };

  const ensureSpace = (needed: number) => {
    // keep some space for totals + notes
    const bottomSafe = M + 140;
    if (y - needed < bottomSafe) {
      page = makePage();
      y = PAGE_H - M;
      drawTopHeader();
      drawTableHeader();
    }
  };

  // ---- Build document ----
  drawTopHeader();
  drawTableHeader();

  // Rows
  const rowFontSize = 9;
  const rowPadY = 6;

  let rowIndex = 1;
  for (const it of d.items) {
    const qty = Number(it.quantity || 0);
    const rate = Number(it.unit_price || 0);
    const disc = Number(it.discount || 0);
    const taxP = Number(it.tax_percent || 0);

    const lineSub = Math.max(qty * rate - disc, 0);
    const lineTax = Math.round(lineSub * (taxP / 100) * 100) / 100;
    const lineTotal = lineSub + lineTax;

    const descLines = wrapText(
      String(it.description || ""),
      cols[1].w - 12,
      font,
      rowFontSize,
    );
    const rowH = Math.max(18, descLines.length * (rowFontSize + 2) + rowPadY);

    ensureSpace(rowH);

    // row outer box
    drawBox(page, tableX, y - rowH, tableW, rowH, { border: true });

    // vertical column lines + text
    let cx = tableX;

    const cellYTop = y - rowPadY - rowFontSize;

    const drawCell = (
      text: string,
      colIdx: number,
      align: "left" | "right",
      lines?: string[],
    ) => {
      const col = cols[colIdx];
      const left = cx;
      const right = cx + col.w;

      if (colIdx !== 0) {
        page.drawLine({
          start: { x: left, y },
          end: { x: left, y: y - rowH },
          thickness: 1,
        });
      }

      if (colIdx === 1 && lines) {
        // multi-line description
        let yy = y - 6 - rowFontSize;
        for (const ln of lines) {
          page.drawText(ln, { x: left + 6, y: yy, size: rowFontSize, font });
          yy -= rowFontSize + 2;
        }
      } else {
        const s = String(text ?? "");
        const textW = font.widthOfTextAtSize(s, rowFontSize);
        const tx =
          align === "right" ? Math.max(left + 6, right - 6 - textW) : left + 6;
        page.drawText(s, { x: tx, y: cellYTop, size: rowFontSize, font });
      }

      cx += col.w;
    };

    drawCell(String(rowIndex), 0, "left");
    drawCell("", 1, "left", descLines);
    drawCell(String(it.hsn_sac ?? ""), 2, "left");
    drawCell(String(qty || ""), 3, "right");
    drawCell(fmtMoney(rate), 4, "right");
    drawCell(fmtMoney(disc), 5, "right");
    drawCell(String(taxP ? taxP.toFixed(0) : "0"), 6, "right");
    drawCell(fmtMoney(lineTotal), 7, "right");

    y -= rowH;
    rowIndex += 1;
  }

  // Totals box
  ensureSpace(120);

  const totalsW = 230;
  const totalsH = 76;
  const totalsX = PAGE_W - M - totalsW;
  const totalsY = y - 12;

  drawBox(page, totalsX, totalsY - totalsH, totalsW, totalsH, {
    border: true,
    fill: { r: 0.98, g: 0.98, b: 0.98 },
  });

  const txL = totalsX + 12;
  const txR = totalsX + totalsW - 12;

  const drawRight = (
    label: string,
    value: string,
    yy: number,
    isBold = false,
  ) => {
    page.drawText(label, {
      x: txL,
      y: yy,
      size: 10,
      font: isBold ? bold : font,
    });
    const w = (isBold ? bold : font).widthOfTextAtSize(value, 10);
    page.drawText(value, {
      x: txR - w,
      y: yy,
      size: 10,
      font: isBold ? bold : font,
    });
  };

  drawRight("Subtotal", fmtMoney(d.subtotal), totalsY - 22, true);

  const taxLabel = (d.taxLabel || "Tax").trim() || "Tax";
  drawRight(taxLabel, fmtMoney(d.tax), totalsY - 40, true);

  page.drawLine({
    start: { x: totalsX + 10, y: totalsY - 48 },
    end: { x: totalsX + totalsW - 10, y: totalsY - 48 },
    thickness: 1,
  });

  drawRight("Grand Total", fmtMoney(d.total), totalsY - 66, true);

  y = totalsY - totalsH - 18;

  // Notes
  if (d.notes) {
    ensureSpace(60);
    page.drawText("Notes:", { x: M, y: y, size: 10, font: bold });
    const lines = wrapText(d.notes, PAGE_W - M * 2, font, 9);
    let ny = y - 14;
    for (const ln of lines.slice(0, 6)) {
      page.drawText(ln, { x: M, y: ny, size: 9, font });
      ny -= 11;
    }
  }

  return await pdfDoc.save();
}

export default function ProductUnitsPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const productId = params.id;

  // NextAuth session (replaces supabase.auth.getSession + onAuthStateChange).
  const { data: session, status: sessionStatus } = useSession();

  // owner/manager => can transfer (write); staff => view-only.
  const { isAdmin } = useVendorRole();

  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const [invoicePrintType, setInvoicePrintType] =
    useState<InvoicePrintType>("CUSTOMER");
  const [invSellerGstin, setInvSellerGstin] = useState("");
  // ---------------- Invoice Create (single/multi) ----------------
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceMode, setInvoiceMode] = useState<"SINGLE" | "MULTI">("SINGLE");
  const [invoiceCompanies, setInvoiceCompanies] = useState<InvoiceCompanyRow[]>(
    [],
  );
  const [invoiceCompanyId, setInvoiceCompanyId] = useState<string>("");

  const [invCustomerName, setInvCustomerName] = useState("");
  const [invBillingAddress, setInvBillingAddress] = useState("");
  const [invPhone, setInvPhone] = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invContactPerson, setInvContactPerson] = useState("");
  const [invGstNumber, setInvGstNumber] = useState("");
  const [invPanNumber, setInvPanNumber] = useState("");

  const [invInvoiceDate, setInvInvoiceDate] = useState<string>(todayYmd);
  // (kept for compatibility; not used in PDF now)
  const [invDueDate, setInvDueDate] = useState<string>("");
  const [invNotes, setInvNotes] = useState("");
  const [invTaxLabel, setInvTaxLabel] = useState("GST");

  const [invItems, setInvItems] = useState<InvoiceDraftItem[]>([]);
  const [invWorking, setInvWorking] = useState(false);

  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [brand, setBrand] = useState<BrandRow | null>(null);

  const [units, setUnits] = useState<UnitRow[]>([]);
  const [sharedCodeRemaining, setSharedCodeRemaining] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [unitInvoiceCustomers, setUnitInvoiceCustomers] = useState<
    Record<string, { name: string | null; phone: string | null; invoice_number: string | null }>
  >({});

  // filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InventoryStatus | "ALL">(
    "ALL",
  );

  const [demoDialogOpen, setDemoDialogOpen] = useState(false);

  // ---------------- Customer details view dialog ----------------
  const [customerViewOpen, setCustomerViewOpen] = useState(false);
  const [customerViewUnit, setCustomerViewUnit] = useState<UnitRow | null>(
    null,
  );
  const [customerViewCustomer, setCustomerViewCustomer] =
    useState<CustomerRow | null>(null);
  const [customerViewLoading, setCustomerViewLoading] = useState(false);
  const [demoTargetUnit, setDemoTargetUnit] = useState<UnitRow | null>(null);
  const [demoAuthOk, setDemoAuthOk] = useState(false);

  // date filters (YYYY-MM-DD)
  const [mfgFrom, setMfgFrom] = useState<string>("");
  const [mfgTo, setMfgTo] = useState<string>("");
  const [expFrom, setExpFrom] = useState<string>("");
  const [expTo, setExpTo] = useState<string>("");

  // kept in logic
  const [includeNoExpiry, setIncludeNoExpiry] = useState<boolean>(true);

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20);
  const [totalCount, setTotalCount] = useState(0);

  // dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<UnitRow | null>(null);

  // per-row update
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // export
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // filters modal
  const [filtersOpen, setFiltersOpen] = useState(false);

  // applied-filters version (fetch only when apply)
  const [filtersVersion, setFiltersVersion] = useState(0);

  // ---------------- Selection (for batch actions) ----------------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const allSelectedOnPage =
    units.length > 0 && units.every((u) => selectedIds.has(u.id));
  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) units.forEach((u) => next.add(u.id));
      else units.forEach((u) => next.delete(u.id));
      return next;
    });
  };

  // ---------------- Transfer-to-product dialog ----------------
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferWorking, setTransferWorking] = useState(false);
  const [transferSearch, setTransferSearch] = useState("");
  const [transferProducts, setTransferProducts] = useState<
    { id: string; name: string }[]
  >([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState<string>("");

  // ---------------- Bulk delete dialog ----------------
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteScope, setBulkDeleteScope] = useState<
    "SELECTED" | "FILTERED"
  >("SELECTED");
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [bulkDeleteAck, setBulkDeleteAck] = useState(false);
  const [bulkDeleteName, setBulkDeleteName] = useState("");

  const [bulkDeleteVerifiedCount, setBulkDeleteVerifiedCount] = useState(0);
  const [bulkDeleteMetaLoading, setBulkDeleteMetaLoading] = useState(false);

  // ✅ bulk delete mode (if verified are in target)
  const [bulkDeleteMode, setBulkDeleteMode] = useState<
    "DELETE_ALL" | "SKIP_VERIFIED"
  >("DELETE_ALL");

  // ---------------- Bulk edit dialog ----------------
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditScope, setBulkEditScope] = useState<"SELECTED" | "FILTERED">(
    "SELECTED",
  );
  const [bulkEditing, setBulkEditing] = useState(false);

  const [bulkNewStatus, setBulkNewStatus] = useState<
    InventoryStatus | "NO_CHANGE"
  >("NO_CHANGE");

  // ✅ dates (empty = no change)
  const [bulkNewMfgDate, setBulkNewMfgDate] = useState<string>("");
  const [bulkNewExpDate, setBulkNewExpDate] = useState<string>("");

  // ---------------- SOLD customer dialog ----------------
  const [soldDialogOpen, setSoldDialogOpen] = useState(false);
  const [soldTargetUnit, setSoldTargetUnit] = useState<UnitRow | null>(null);

  const [custQuery, setCustQuery] = useState("");
  const [custLoading, setCustLoading] = useState(false);
  const [custSuggestions, setCustSuggestions] = useState<CustomerRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );

  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [userId, setUserId] = useState<string>("");

  // ---------------- Admin override delete (single verified unit delete) ----------------
  const [overrideDeleteOpen, setOverrideDeleteOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<UnitRow | null>(null);
  const [overrideConfirm, setOverrideConfirm] = useState("");
  const [overrideWorking, setOverrideWorking] = useState(false);

  // ---------------- Status override (SOLD/RETURNED + SOLD lock) ----------------
  const [statusOverrideOpen, setStatusOverrideOpen] = useState(false);
  const [statusOverrideUnit, setStatusOverrideUnit] = useState<UnitRow | null>(
    null,
  );
  const [statusOverrideNext, setStatusOverrideNext] =
    useState<InventoryStatus | null>(null);
  const [statusOverrideConfirm, setStatusOverrideConfirm] = useState("");
  const [statusOverrideWorking, setStatusOverrideWorking] = useState(false);

  // sort
  const [sortBy, setSortBy] = useState<
    | "created_desc"
    | "created_asc"
    | "exp_asc"
    | "exp_desc"
    | "mfg_desc"
    | "mfg_asc"
    | "code_asc"
    | "code_desc"
  >("created_desc");

  // expired quick filter
  const [expiredFilter, setExpiredFilter] = useState<
    "ALL" | "EXPIRED" | "NOT_EXPIRED"
  >("ALL");

  const resetSoldForm = () => {
    setCustQuery("");
    setCustSuggestions([]);
    setSelectedCustomerId(null);
    setCustName("");
    setCustPhone("");
    setCustEmail("");
    setCustAddress("");
  };
  const openCustomerDetails = async (u: UnitRow) => {
    const soldCustomerId =
      (u as any).sold_customer_id ?? u.sold_customer_id ?? null;
    const demoCustomerId =
      (u as any).demo_customer_id ?? u.demo_customer_id ?? null;
    const customerId =
      u.status === "SOLD"
        ? soldCustomerId
        : u.status === "DEMO"
          ? demoCustomerId
          : null;

    setCustomerViewUnit(u);
    setCustomerViewCustomer(null);
    setCustomerViewOpen(true);

    if (!customerId) return;

    setCustomerViewLoading(true);
    try {
      const res = await fetch(
        `/api/vendor/customers?id=${encodeURIComponent(customerId)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        toast.error(body?.error || "Failed to load customer");
        return;
      }
      if (body.data) setCustomerViewCustomer(body.data);
    } finally {
      setCustomerViewLoading(false);
    }
  };

  const openStatusOverride = (u: UnitRow, next: InventoryStatus) => {
    setStatusOverrideUnit(u);
    setStatusOverrideNext(next);
    setStatusOverrideConfirm("");
    setStatusOverrideOpen(true);
  };

  const [invSellerPan, setInvSellerPan] = useState("");
  // ---------------- Scan modal ----------------
  const [scanOpen, setScanOpen] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [scannedUnit, setScannedUnit] = useState<UnitRow | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const comp = invoiceCompanies.find((c) => c.id === invoiceCompanyId);
    if (!comp) return;

    // Prefill seller GST/PAN from selected company
    setInvGstNumber(comp.gst_number ?? "");
    setInvPanNumber(comp.pan_number ?? "");
  }, [invoiceCompanyId, invoiceCompanies]);

  useEffect(() => {
    if (!scanOpen) return;
    const t = setTimeout(() => {
      scanInputRef.current?.focus();
      scanInputRef.current?.select();
    }, 80);
    return () => clearTimeout(t);
  }, [scanOpen]);

  const resetScan = () => {
    setScanValue("");
    setScannedUnit(null);
    setTimeout(() => {
      scanInputRef.current?.focus();
      scanInputRef.current?.select();
    }, 50);
  };

  useEffect(() => {
    if (statusOverrideOpen) {
      // clear the typed confirmation every time the dialog opens
      setStatusOverrideConfirm("");
    }
  }, [statusOverrideOpen]);

  // ---------------- Auth + vendor ----------------
  // Driven by the NextAuth session (useSession). The effect re-runs as the
  // session resolves: "loading" -> wait; "unauthenticated" -> login;
  // "authenticated" -> fetch the vendor and gate on approval.
  useEffect(() => {
    if (sessionStatus === "loading") return;

    let cancelled = false;

    if (sessionStatus === "unauthenticated" || !session?.user) {
      setHydrated(true);
      router.replace("/vendor/login");
      return;
    }

    setUserId((session.user as any)?.id ?? "");
    setHydrated(true);

    (async () => {
      let v: VendorInfo | undefined;
      try {
        const res = await fetch("/api/vendor/me", { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        const raw = body?.vendor;
        if (raw) v = { id: raw.id, display_name: raw.display_name, status: raw.status } as VendorInfo;
      } catch (error) {
        console.error("get_my_vendor error", error);
        router.replace("/vendor");
        return;
      }

      if (cancelled) return;

      if (!v || v.status !== "approved") {
        router.replace("/vendor");
        return;
      }

      setVendor(v);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, sessionStatus, session]);

  // -------- Load invoice companies --------
  useEffect(() => {
    if (!ready) return;

    (async () => {
      try {
        const res = await fetch("/api/vendor/invoice-companies?mode=full", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok || !body?.ok) {
          console.warn(body?.error);
          return;
        }
        const data = (body.data ?? []) as any[];
        setInvoiceCompanies(data as any);

        // ✅ default select first if empty
        if (!invoiceCompanyId && data.length > 0) {
          setInvoiceCompanyId(data[0].id);
        }
      } catch (e) {
        console.warn(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const invTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    let total = 0;

    for (const it of invItems) {
      const lineSub = Math.max(it.quantity * it.unit_price - it.discount, 0);
      const lineTax = Math.round(lineSub * (it.tax_percent / 100) * 100) / 100;
      const lineTotal = lineSub + lineTax;

      subtotal += lineSub;
      tax += lineTax;
      total += lineTotal;
    }

    subtotal = Math.round(subtotal * 100) / 100;
    tax = Math.round(tax * 100) / 100;
    total = Math.round(total * 100) / 100;

    return { subtotal, tax, total };
  }, [invItems]);

  const resetInvoiceDraft = () => {
    setInvoiceCompanyId("");
    setInvCustomerName("");
    setInvBillingAddress("");
    setInvPhone("");
    setInvEmail("");
    setInvContactPerson("");
    setInvGstNumber("");
    setInvPanNumber("");

    setInvSellerGstin(""); // ✅ NEW
    setInvoicePrintType("CUSTOMER"); // ✅ NEW

    setInvInvoiceDate(todayYmd);
    setInvDueDate("");
    setInvNotes("");
    setInvTaxLabel("GST");
    setInvItems([]);
  };

  // ---------------- Invoice open helpers ----------------
  const openInvoiceSingle = (u: UnitRow) => {
    if (!product) return toast.error("Product not loaded");
    if (u.status !== "SOLD")
      return toast.error("Invoice can be generated only for SOLD units");

    setInvoiceMode("SINGLE");
    resetInvoiceDraft();

    setInvCustomerName(u.sold_customer_name ?? "");
    setInvPhone(u.sold_customer_phone ?? "");

    const price = Number(u.price ?? product.sale_price ?? 0);
    setInvItems([
      {
        id: crypto.randomUUID(),
        unit_id: u.id,
        description:
          invoicePrintType === "ADMIN"
            ? `${product.name} — Unit ${getVisibleUnitCode(u)}`
            : `${product.name}`,

        hsn_sac: "",
        quantity: 1,
        unit_price: Number.isFinite(price) ? price : 0,
        discount: 0,
        tax_percent: 0,
      },
    ]);

    setInvoiceOpen(true);
  };

  useEffect(() => {
    const c = invoiceCompanies.find((x) => x.id === invoiceCompanyId);
    if (!c) return;
    // if user didn't manually set, auto-fill from company GST
    if (!invSellerGstin) setInvSellerGstin(c.gst_number ?? "");
  }, [invoiceCompanyId, invoiceCompanies, invSellerGstin]);

  const fetchSelectedUnits = async (): Promise<UnitRow[]> => {
    if (!vendor?.id) return [];
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return [];

    const out: UnitRow[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);

      try {
        const res = await fetch(
          `/api/vendor/inventory-units?mode=by-ids&productId=${encodeURIComponent(productId)}&ids=${encodeURIComponent(slice.join(","))}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!res.ok || !body?.ok) {
          toast.error(body?.error || "Failed to load selected units");
          return [];
        }
        out.push(...((body.data ?? []) as any as UnitRow[]));
      } catch (e: any) {
        toast.error(e?.message || "Failed to load selected units");
        return [];
      }
    }

    return out;
  };

  const saveDemoWithCustomer = async () => {
    if (!vendor?.id || !demoTargetUnit) return;
    const name = custName.trim();
    const phone = custPhone.trim();

    const customerId = await resolveOrCreateCustomer();
    if (!customerId) return;

    setUpdatingId(demoTargetUnit.id);
    try {
      const { ok, data } = await postJson("/api/vendor/inventory-units/status", {
        ids: [demoTargetUnit.id],
        productId,
        status: "DEMO",
        demo: { id: customerId, name, phone },
      });

      if (!ok) {
        toast.error(data?.error || "Failed to mark DEMO");
        return;
      }

      toast.success("Marked DEMO with customer details");

      if (scannedUnit?.id === demoTargetUnit.id) {
        setScannedUnit((prev) =>
          prev
            ? {
                ...prev,
                status: "DEMO",
                demo_customer_name: name,
                demo_customer_phone: phone || null,
              }
            : prev,
        );
      }

      setDemoDialogOpen(false);
      setDemoTargetUnit(null);
      resetSoldForm(); // reused form
      setDemoAuthOk(false);
      await loadAll();
    } finally {
      setUpdatingId(null);
    }
  };

  const openInvoiceMultiFromSelected = async () => {
    if (!product) return toast.error("Product not loaded");
    if (selectedIds.size === 0) return toast.error("Select units first");

    const rows = await fetchSelectedUnits();
    if (rows.length === 0) return;

    const notSold = rows.filter((r) => r.status !== "SOLD");
    if (notSold.length > 0) {
      toast.error(
        `Only SOLD units can be invoiced. Not SOLD: ${notSold.length}`,
      );
      return;
    }

    setInvoiceMode("MULTI");
    resetInvoiceDraft();

    // if all have same customer, prefill
    const firstName = rows[0].sold_customer_name ?? "";
    const sameName = rows.every(
      (r) => (r.sold_customer_name ?? "") === firstName,
    );
    if (sameName) setInvCustomerName(firstName);

    const firstPhone = rows[0].sold_customer_phone ?? "";
    const samePhone = rows.every(
      (r) => (r.sold_customer_phone ?? "") === firstPhone,
    );
    if (samePhone) setInvPhone(firstPhone);

    setInvItems(
      rows.map((u) => {
        const price = Number(u.price ?? product.sale_price ?? 0);
        return {
          id: crypto.randomUUID(),
          unit_id: u.id,
          description:
            invoicePrintType === "ADMIN"
              ? `${product.name} — Unit ${getVisibleUnitCode(u)}`
              : `${product.name}`,

          hsn_sac: "",
          quantity: 1,
          unit_price: Number.isFinite(price) ? price : 0,
          discount: 0,
          tax_percent: 0,
        };
      }),
    );

    setInvoiceOpen(true);
  };

  // ✅ Create PDF once (used for Print + Download)
  const buildCurrentInvoicePdfBytes = async () => {
    const comp = invoiceCompanies.find((c) => c.id === invoiceCompanyId);

    const invoiceNumber = `INV-${Date.now()}`; // local number (no API)
    const draft: DraftInvoiceForPdf = {
      invoiceNumber,
      invoiceDate: invInvoiceDate || todayYmd,
      companyName: comp?.display_name || "Invoice Company",
      companyGst: invGstNumber || comp?.gst_number || undefined,
      companyPan: invPanNumber || comp?.pan_number || undefined,
      companyAddress: comp?.address || undefined,
      customerName: invCustomerName || "-",
      customerPhone: invPhone || undefined,
      customerEmail: invEmail || undefined,
      billingAddress: invBillingAddress || undefined,
      taxLabel: invTaxLabel || "GST",
      notes: invNotes || undefined,
      items: invItems.map((it) => ({
        description: it.description,
        hsn_sac: it.hsn_sac || null,
        quantity: Number(it.quantity || 1),
        unit_price: Number(it.unit_price || 0),
        discount: Number(it.discount || 0),
        tax_percent: Number(it.tax_percent || 0),
      })),
      subtotal: invTotals.subtotal,
      tax: invTotals.tax,
      total: invTotals.total,
    };

    return await buildInvoicePdfFromDraft(draft);
  };

  const createInvoiceNow = async () => {
    const isAdmin = invoicePrintType === "ADMIN";

    const rows = invItems.map((it, idx) => {
      const baseDesc = (it.description || "").trim();

      // CUSTOMER: remove unit part if present
      const customerDesc = baseDesc.includes("—")
        ? baseDesc.split("—")[0].trim()
        : baseDesc;

      const description = isAdmin ? baseDesc : customerDesc;

      const qty = Math.max(1, Number(it.quantity || 1));
      const rate = Math.max(0, Number(it.unit_price || 0));
      const discount = Math.max(0, Number(it.discount || 0));
      const tax_percent = Math.max(0, Number(it.tax_percent || 0));

      const base = Math.max(qty * rate - discount, 0); // subtotal for this row
      const tax = Math.round(base * (tax_percent / 100) * 100) / 100;
      const amount = Math.round((base + tax) * 100) / 100;

      return {
        idx: idx + 1,
        description,
        hsn_sac: it.hsn_sac || "",
        qty,
        rate,
        discount,
        tax_percent,
        base,
        tax,
        amount,
      };
    });

    const subtotal =
      Math.round(rows.reduce((a, r) => a + r.base, 0) * 100) / 100;
    const taxTotal =
      Math.round(rows.reduce((a, r) => a + r.tax, 0) * 100) / 100;
    const grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;

    if (!invoiceCompanyId) return toast.error("Select invoice company");
    if (!invCustomerName.trim())
      return toast.error("Customer name is required");
    if (invItems.length === 0) return toast.error("No invoice items");

    if (invoiceMode === "SINGLE" && invItems.length !== 1) {
      return toast.error("Single invoice must have exactly 1 unit");
    }

    const comp =
      invoiceCompanies.find((c) => c.id === invoiceCompanyId) || null;
    if (!comp) return toast.error("Invoice company not found");

    setInvWorking(true);
    try {
      // ✅ Generate invoice no (frontend only)
      const invoiceNo =
        "MK" +
        new Date().getFullYear() +
        "-" +
        String(Math.floor(Math.random() * 900000 + 100000));

      const invoiceDate =
        invInvoiceDate || new Date().toISOString().slice(0, 10);

      // ---- helpers ----
      const money = (n: number) => {
        const x = Number.isFinite(n) ? n : 0;
        return x.toFixed(2);
      };

      const safe = (s?: string | null) => String(s ?? "").trim();

      const wrapText = (text: string, maxChars: number) => {
        const t = safe(text);
        if (!t) return [""];
        const words = t.split(/\s+/);
        const lines: string[] = [];
        let cur = "";
        for (const w of words) {
          const next = cur ? `${cur} ${w}` : w;
          if (next.length > maxChars) {
            if (cur) lines.push(cur);
            cur = w;
          } else cur = next;
        }
        if (cur) lines.push(cur);
        return lines.length ? lines : [t];
      };

      // ---- totals ----

      // const rows = invItems.map((it) => {
      //   const qty = Math.max(1, Number(it.quantity || 1));
      //   const rate = Math.max(0, Number(it.unit_price || 0));
      //   const disc = Math.max(0, Number(it.discount || 0));
      //   const base = Math.max(qty * rate - disc, 0);
      //   const tax = Math.round(base * (Number(it.tax_percent || 0) / 100) * 100) / 100;
      //   const amount = base + tax;
      //   subtotal += base;
      //   taxTotal += tax;
      //   grandTotal += amount;
      //   return { ...it, qty, rate, disc, base, tax, amount };
      // });

      // ---- PDF ----
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]); // A4
      const { width, height } = page.getSize();

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const margin = 48;
      let y = height - margin;

      const line = (yy: number) => {
        page.drawLine({
          start: { x: margin, y: yy },
          end: { x: width - margin, y: yy },
          thickness: 1,
        });
      };

      const text = (
        t: string,
        x: number,
        yy: number,
        size = 10,
        isBold = false,
      ) => {
        page.drawText(safe(t), { x, y: yy, size, font: isBold ? bold : font });
      };

      const rightText = (
        t: string,
        rightX: number,
        yy: number,
        size = 10,
        isBold = false,
      ) => {
        const f = isBold ? bold : font;
        const w = f.widthOfTextAtSize(t, size);
        page.drawText(t, { x: rightX - w, y: yy, size, font: f });
      };

      // ---- HEADER (left company, right invoice box) ----
      text(
        comp.display_name || comp.legal_name || "Company",
        margin,
        y,
        13,
        true,
      );
      y -= 18;

      if (
        safe(comp.legal_name) &&
        safe(comp.legal_name) !== safe(comp.display_name)
      ) {
        text(comp.legal_name || "", margin, y, 9, false);
        y -= 14;
      }

      if (safe(comp.email)) {
        text(`Support Email: ${safe(comp.email)}`, margin, y, 9, false);
        y -= 14;
      }
      text(`Contact: 9384857587, 9384857579, 9962110101`, margin, y, 9, false);
      y -= 14;

      rightText("INVOICE", width - margin, height - margin, 12, true);
      rightText(
        `Invoice No: ${invoiceNo}`,
        width - margin,
        height - margin - 18,
        10,
        false,
      );
      rightText(
        `Invoice Date: ${invoiceDate}`,
        width - margin,
        height - margin - 34,
        10,
        false,
      );

      y -= 6;
      line(y);
      y -= 24;

      // ---- BILL TO / INVOICE INFO ----
      const leftX = margin;
      const rightX = width / 2 + 10;

      text("Bill To", leftX, y, 10, true);
      text("Invoice Info", rightX, y, 10, true);
      y -= 16;

      const billLines: string[] = [];
      billLines.push(invCustomerName.trim() || "-");
      if (safe(invBillingAddress))
        billLines.push(...wrapText(invBillingAddress, 42));
      if (safe(invPhone)) billLines.push(`Phone: ${safe(invPhone)}`);
      if (safe(invGstNumber)) billLines.push(`GSTIN: ${safe(invGstNumber)}`);
      if (safe(invPanNumber)) billLines.push(`PAN: ${safe(invPanNumber)}`);

      let billY = y;
      for (const bl of billLines) {
        text(bl, leftX, billY, 9, false);
        billY -= 13;
      }

      const infoLines: string[] = [];
      if (safe(invEmail)) infoLines.push(`Customer Email: ${safe(invEmail)}`);
      // if (safe(comp.gst_number)) infoLines.push(`Seller GSTIN: ${safe(comp.gst_number)}`);
      if (safe(comp.pan_number))
        infoLines.push(`Seller PAN: ${safe(comp.pan_number)}`);

      let infoY = y;
      for (const il of infoLines) {
        text(il, rightX, infoY, 9, false);
        infoY -= 13;
      }

      y = Math.min(billY, infoY) - 14;
      line(y);
      y -= 22;

      // ---- TABLE HEADER (FIXED WIDTH, NO CUT-OFF) ----
      const tableLeft = margin;
      const tableRight = width - margin;
      const tableW = tableRight - tableLeft;

      // column widths (tuned to fit A4 usable width)
      const W_NO = 20;
      const W_DESC = Math.max(160, Math.floor(tableW * 0.4)); // flexible
      const W_HSN = 60;
      const W_QTY = 32;
      const W_UNIT = 68;
      const W_TAX = 44;

      // Amount takes remaining width
      const W_AMT = tableW - (W_NO + W_DESC + W_HSN + W_QTY + W_UNIT + W_TAX);

      const X_NO = tableLeft;
      const X_DESC = X_NO + W_NO;
      const X_HSN = X_DESC + W_DESC;
      const X_QTY = X_HSN + W_HSN;
      const X_UNIT = X_QTY + W_QTY;
      const X_TAX = X_UNIT + W_UNIT;
      const X_AMT = X_TAX + W_TAX; // left of amount col

      const PAD = 4;

      // helper: wrap text by actual width (pdf-lib font metrics)
      const wrapByWidth = (value: string, maxWidth: number, size = 9) => {
        const s = String(value ?? "").trim();
        if (!s) return [""];
        const words = s.split(/\s+/);
        const lines: string[] = [];
        let cur = "";

        for (const w of words) {
          const trial = cur ? `${cur} ${w}` : w;
          const trialW = font.widthOfTextAtSize(trial, size);
          if (trialW <= maxWidth) {
            cur = trial;
          } else {
            if (cur) lines.push(cur);
            cur = w;
          }
        }
        if (cur) lines.push(cur);
        return lines.length ? lines : [s];
      };

      const drawRowLine = (yy: number) => {
        page.drawLine({
          start: { x: tableLeft, y: yy },
          end: { x: tableRight, y: yy },
          thickness: 1,
        });
      };

      // header text
      text("#", X_NO + PAD, y, 9, true);
      text("Description", X_DESC + PAD, y, 9, true);
      text("HSN/SAC", X_HSN + PAD, y, 9, true);
      rightText("Qty", X_QTY + W_QTY - PAD, y, 9, true);
      rightText("Unit Price", X_UNIT + W_UNIT - PAD, y, 9, true);
      rightText("Tax %", X_TAX + W_TAX - PAD, y, 9, true);
      rightText("Amount", X_AMT + W_AMT - PAD, y, 9, true);

      y -= 12;
      drawRowLine(y);
      y -= 16;

      // ---- TABLE ROWS (NO OVERFLOW) ----
      rows.forEach((r, idx) => {
        // wrap description within description column width
        const descLines = wrapByWidth(r.description, W_DESC - PAD * 2, 9).slice(
          0,
          3,
        );

        const rowTopY = y;

        // No
        text(String(idx + 1), X_NO + PAD, rowTopY, 9, false);

        // Description (multi-line)
        descLines.forEach((ln, i) => {
          text(ln, X_DESC + PAD, rowTopY - i * 12, 9, false);
        });

        // HSN
        text(String(r.hsn_sac || ""), X_HSN + PAD, rowTopY, 9, false);

        // Qty / Unit / Tax / Amount (right aligned)
        rightText(String(r.qty), X_QTY + W_QTY - PAD, rowTopY, 9, false);
        rightText(money(r.rate), X_UNIT + W_UNIT - PAD, rowTopY, 9, false);
        rightText(
          money(Number(r.tax_percent || 0)),
          X_TAX + W_TAX - PAD,
          rowTopY,
          9,
          false,
        );
        rightText(money(r.amount), X_AMT + W_AMT - PAD, rowTopY, 9, false);

        // row height based on wrapped lines
        const rowH = Math.max(14, descLines.length * 12);
        y -= rowH + 10;
      });

      y -= 6;
      drawRowLine(y);
      y -= 18;

      // ---- TOTALS ----
      const valX = width - margin;

      rightText("Subtotal", valX - 70, y, 10, false);
      rightText(money(subtotal), valX, y, 10, false);
      y -= 14;

      rightText(invTaxLabel || "Tax", valX - 70, y, 10, false);
      rightText(money(taxTotal), valX, y, 10, false);
      y -= 16;

      rightText("Total", valX - 70, y, 11, true);
      rightText(money(grandTotal), valX, y, 11, true);

      y -= 30;
      line(y);
      y -= 18;

      // ---- NOTES + POLICY ----
      text("Notes", margin, y, 10, true);
      y -= 14;

      const notesLines = wrapText(invNotes || "", 85);
      notesLines.slice(0, 4).forEach((nl) => {
        text(nl, margin, y, 9, false);
        y -= 13;
      });

      y -= 10;

      const disclaimer = [
        "Reseller Disclaimer",
        "We are resellers and are not responsible for product usage or handling guidance.",
        "For detailed information on how to use the product safely and effectively, please contact the product manufacturer directly.",
        "",
        "Return Policy",
        "• Returns are accepted within 5 days from the date of delivery.",
        "• Returns are only accepted for products with damaged packaging or expired items.",
        "• Used products or items with broken or tampered seals are not eligible for return.",
      ];

      disclaimer.forEach((dl, i) => {
        if (!dl) {
          y -= 8;
          return;
        }
        text(
          dl,
          margin,
          y,
          i === 0 || dl === "Return Policy" ? 9 : 8.8,
          i === 0 || dl === "Return Policy",
        );
        y -= 12.5;
      });

      const pdfBytes = await pdfDoc.save();

      // ✅ Open + Download
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      // open in new tab (user prints from PDF viewer)
      window.open(url, "_blank", "noopener,noreferrer");

      // auto-download too
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice_${invoiceNo}.pdf`;
      a.click();

      toast.success("Invoice PDF generated");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to generate invoice PDF");
    } finally {
      setInvWorking(false);
    }
  };

  // -------- Load product + brand (once) --------
  useEffect(() => {
    if (!ready || !vendor?.id) return;
    let cancelled = false;

    (async () => {
      let p: any = null;
      try {
        const res = await fetch(
          `/api/vendor/products?mode=single&id=${encodeURIComponent(productId)}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body?.ok) {
          toast.error(body?.error || "Failed to load product");
          return;
        }
        p = body.data;
      } catch (e: any) {
        if (cancelled) return;
        toast.error(e?.message || "Failed to load product");
        return;
      }

      setProduct(p as any);

      const bId = (p as any)?.brand_id as string | null;
      if (bId) {
        try {
          const bRes = await fetch(
            `/api/vendor/brands?id=${encodeURIComponent(bId)}`,
            { cache: "no-store" },
          );
          const bBody = await bRes.json();
          if (!cancelled) {
            if (!bRes.ok || !bBody?.ok) setBrand(null);
            else setBrand((bBody.data ?? null) as any);
          }
        } catch {
          if (!cancelled) setBrand(null);
        }
      } else {
        setBrand(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, vendor?.id, productId, productId]);

  // ---------------- Filters serialized into server query params ----------------
  // Mirrors the old applyUnitFilters(); the server endpoint rebuilds the exact
  // same Prisma where-clause from these params (vendor-scoped server side).
  function buildUnitFilterParams(
    opts: { includeStatus?: boolean } = { includeStatus: true },
  ) {
    const qp = new URLSearchParams();
    qp.set("productId", productId);
    qp.set("today", todayYmd);

    if (opts.includeStatus !== false && statusFilter !== "ALL") {
      qp.set("statusFilter", statusFilter);
    }

    const s = search.trim();
    if (s) qp.set("search", s);

    if (expiredFilter !== "ALL") qp.set("expiredFilter", expiredFilter);
    qp.set("includeNoExpiry", includeNoExpiry ? "true" : "false");

    if (mfgFrom) qp.set("mfgFrom", mfgFrom);
    if (mfgTo) qp.set("mfgTo", mfgTo);
    if (expFrom) qp.set("expFrom", expFrom);
    if (expTo) qp.set("expTo", expTo);

    return qp;
  }

  // The old applyUnitFilters / baseUnitsQuery Supabase query-builders were
  // removed: every read AND write now goes through the vendor-scoped
  // /api/vendor/inventory-units endpoints (buildUnitFilterParams for reads;
  // the same filter payload is sent to the delete/update endpoints for writes).

  const computeBulkDeleteMeta = async (scope: "SELECTED" | "FILTERED") => {
    if (!vendor?.id) return;

    setBulkDeleteMetaLoading(true);
    try {
      if (scope === "SELECTED") {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
          setBulkDeleteVerifiedCount(0);
          return;
        }

        let verified = 0;

        for (let i = 0; i < ids.length; i += 500) {
          const slice = ids.slice(i, i + 500);
          const res = await fetch(
            `/api/vendor/inventory-units?mode=verified-count&productId=${encodeURIComponent(productId)}&ids=${encodeURIComponent(slice.join(","))}`,
            { cache: "no-store" },
          );
          const body = await res.json();
          if (!res.ok || !body?.ok) throw new Error(body?.error || "Failed");
          verified += Number(body.data ?? 0);
        }

        setBulkDeleteVerifiedCount(verified);
      } else {
        const qp = buildUnitFilterParams();
        qp.set("mode", "verified-count");
        const res = await fetch(`/api/vendor/inventory-units?${qp.toString()}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok || !body?.ok) throw new Error(body?.error || "Failed");
        setBulkDeleteVerifiedCount(Number(body.data ?? 0));
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to analyze bulk delete set");
      setBulkDeleteVerifiedCount(0);
    } finally {
      setBulkDeleteMetaLoading(false);
    }
  };

  const fetchSharedCodeRemaining = async () => {
    if (!vendor?.id) return;

    try {
      const res = await fetch(
        `/api/vendor/inventory-units?mode=shared-remaining&productId=${encodeURIComponent(productId)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || "Failed");
      const data = body.data as any[];

      const next: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ unit_code?: string | null; scan_code?: string | null; status?: string | null }>) {
        const key = getVisibleUnitCode(row);
        if (!key) continue;
        if ((row.status ?? "") === "IN_STOCK") {
          next[key] = (next[key] ?? 0) + 1;
        } else if (!(key in next)) {
          next[key] = 0;
        }
      }

      setSharedCodeRemaining(next);
    } catch (e) {
      console.error(e);
    }
  };

  // -------- Fetch units --------
  // ---------------- Transfer to product ----------------
  const openTransferDialog = async () => {
    if (selectedIds.size === 0) return toast.error("Select units first");
    setTransferTargetId("");
    setTransferSearch("");
    setTransferOpen(true);
    await loadTransferProducts("");
  };

  const loadTransferProducts = async (term: string) => {
    if (!vendor?.id) return;
    setTransferLoading(true);
    try {
      const qp = new URLSearchParams();
      qp.set("mode", "list");
      qp.set("pageSize", "50");
      if (term.trim()) qp.set("search", term.trim());
      const res = await fetch(`/api/vendor/products?${qp.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        toast.error(body?.error || "Failed to load products");
        setTransferProducts([]);
        return;
      }
      // exclude the current product as a target
      const rows = ((body.data ?? []) as any[])
        .filter((p) => p.id !== productId)
        .map((p) => ({ id: String(p.id), name: String(p.name ?? "") }));
      setTransferProducts(rows);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load products");
      setTransferProducts([]);
    } finally {
      setTransferLoading(false);
    }
  };

  const confirmTransfer = async () => {
    if (selectedIds.size === 0) return toast.error("Select units first");
    if (!transferTargetId) return toast.error("Select a target product");

    setTransferWorking(true);
    try {
      const { ok, data } = await postJson(
        "/api/vendor/inventory-units/transfer",
        {
          unit_ids: Array.from(selectedIds),
          target_product_id: transferTargetId,
        },
      );

      if (!ok) {
        toast.error(data?.error || "Transfer failed");
        return;
      }

      const n = data?.transferred ?? 0;
      toast.success(`Transferred ${n} unit${n === 1 ? "" : "s"}`);
      setTransferOpen(false);
      setTransferTargetId("");
      setSelectedIds(new Set());
      await loadAll();
    } finally {
      setTransferWorking(false);
    }
  };

  const fetchUnits = async () => {
    if (!vendor?.id) return;

    setLoading(true);
    try {
      const qp = buildUnitFilterParams();
      qp.set("mode", "list");
      qp.set("sortBy", sortBy);
      qp.set("page", String(page));
      qp.set("pageSize", String(pageSize));

      const res = await fetch(`/api/vendor/inventory-units?${qp.toString()}`, { cache: "no-store" });
      const body = await res.json();

      if (!res.ok || !body?.ok) {
        toast.error(body?.error || "Failed to load units");
        setUnits([]);
        setTotalCount(0);
      } else {
        setUnits((body.data ?? []) as any);
        setTotalCount(body.count ?? 0);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !vendor?.id) return;
    // Selection is per-page-view: clear it whenever the page, page size,
    // status filter, search/filters, or expired filter changes so a bulk
    // action can never hit off-screen units.
    setSelectedIds(new Set());
    fetchUnits();
    fetchSharedCodeRemaining();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    vendor?.id,
    productId,
    page,
    pageSize,
    statusFilter,
    filtersVersion,
    sortBy,
    expiredFilter,
  ]);

  // Load invoice customer fallback for displayed units (for SOLD/DEMO/RETURNED
  // units where direct customer fields on the unit row may be empty).
  useEffect(() => {
    let cancelled = false;

    const loadInvoiceCustomers = async () => {
      if (!units || units.length === 0) {
        setUnitInvoiceCustomers({});
        return;
      }

      const unitIds = units.map((u) => u.id);

      try {
        const res = await fetch(
          `/api/vendor/invoice-units?mode=customer-fallback&unitIds=${encodeURIComponent(unitIds.join(","))}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body?.ok) {
          setUnitInvoiceCustomers({});
          return;
        }
        setUnitInvoiceCustomers((body.data ?? {}) as any);
      } catch {
        if (!cancelled) setUnitInvoiceCustomers({});
      }
    };

    loadInvoiceCustomers();

    return () => {
      cancelled = true;
    };
  }, [units]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // ✅ Overall counts across ALL matching units (not only current page)
  const [countsAll, setCountsAll] = useState<Record<InventoryStatus, number>>({
    IN_STOCK: 0,
    INVOICED: 0,
    DEMO: 0,
    SOLD: 0,
    RETURNED: 0,
    OUT_OF_STOCK: 0,
  });

  const fetchCountsAll = async () => {
    if (!vendor?.id) return;

    // Counts ignore the status filter (header shows the whole matching dataset).
    try {
      const qp = buildUnitFilterParams({ includeStatus: false });
      qp.set("mode", "counts");
      const res = await fetch(`/api/vendor/inventory-units?${qp.toString()}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || "Failed");

      const d = body.data ?? {};
      const next: Record<InventoryStatus, number> = {
        IN_STOCK: Number(d.IN_STOCK ?? 0),
        INVOICED: Number(d.INVOICED ?? 0),
        DEMO: Number(d.DEMO ?? 0),
        SOLD: Number(d.SOLD ?? 0),
        RETURNED: Number(d.RETURNED ?? 0),
        OUT_OF_STOCK: Number(d.OUT_OF_STOCK ?? 0),
      };
      setCountsAll(next);
    } catch (e: any) {
      console.error(e);
      // don't spam: only toast once on failure
      toast.error(e?.message || "Failed to compute overall counts");
    }
  };

  // Reload the full view (page list + summary counts + shared-code remaining).
  // Call this after any mutation so the "In stock" / "Remaining in stock"
  // summaries stay in sync without a manual Refresh.
  const loadAll = async () => {
    await Promise.all([
      fetchUnits(),
      fetchCountsAll(),
      fetchSharedCodeRemaining(),
    ]);
  };

  useEffect(() => {
    if (!ready || !vendor?.id) return;
    // Header counts should represent the whole dataset (matching filters), not the current page.
    // We intentionally ignore statusFilter inside fetchCountsAll.
    fetchCountsAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    vendor?.id,
    productId,
    filtersVersion,
    expiredFilter,
    includeNoExpiry,
    // statusFilter is intentionally excluded because counts ignore it.
  ]);

  const countsThisPage = useMemo(() => {
    const out: Record<InventoryStatus, number> = {
      IN_STOCK: 0,
      INVOICED: 0,
      DEMO: 0,
      SOLD: 0,
      RETURNED: 0,
      OUT_OF_STOCK: 0,
    };
    for (const u of units) out[u.status] = (out[u.status] || 0) + 1;
    return out;
  }, [units]);

  const expiredCountThisPage = useMemo(() => {
    let n = 0;
    for (const u of units) {
      const exp = u.expiry_date ? String(u.expiry_date).slice(0, 10) : null;
      if (exp && exp < todayYmd) n += 1;
    }
    return n;
  }, [units, todayYmd]);

  const activeFilterSummary = useMemo(() => {
    const chips: string[] = [];
    const s = search.trim();
    if (s) chips.push(`Search: ${s}`);
    if (statusFilter !== "ALL") chips.push(`Status: ${statusFilter}`);
    if (mfgFrom || mfgTo)
      chips.push(`MFG: ${mfgFrom || "…"} → ${mfgTo || "…"}`);
    if (expFrom || expTo)
      chips.push(
        `EXP: ${expFrom || "…"} → ${expTo || "…"}${
          includeNoExpiry ? " (+null)" : ""
        }`,
      );
    return chips;
  }, [search, statusFilter, mfgFrom, mfgTo, expFrom, expTo, includeNoExpiry]);

  // ---------------- Verified lock ----------------
  const markVerified = async (u: UnitRow) => {
    if (!vendor?.id) return;

    if (u.is_verified) {
      toast.info("Already verified.");
      return;
    }

    const yes = confirm(
      `Mark this unit as VERIFIED?\n\n${getVisibleUnitCode(u)}\n\nAfter verification it is locked; deleting it requires an explicit typed confirmation.`,
    );
    if (!yes) return;

    const { ok, data } = await postJson("/api/vendor/inventory-units/update", {
      ids: [u.id],
      patch: {
        is_verified: true,
        verified_at: new Date().toISOString(),
        verified_by: userId || null,
      },
    });

    if (!ok) {
      toast.error(data?.error || "Failed to verify unit");
      return;
    }

    toast.success("Unit verified");
    fetchUnits();
  };

  // ---------------- Single edit/delete ----------------
  const openEdit = (u: UnitRow) => {
    if (u.is_verified) {
      toast.error("This unit is VERIFIED. Editing is locked.");
      return;
    }
    setEditUnit(u);
    setEditOpen(true);
  };

  const deleteUnit = async (u: UnitRow) => {
    if (!vendor?.id) return;

    if (u.is_verified) {
      toast.error("This unit is VERIFIED. Normal delete is blocked.");
      setOverrideTarget(u);
      setOverrideConfirm("");
      setOverrideDeleteOpen(true);
      return;
    }

    const yes = confirm(`Delete unit ${getVisibleUnitCode(u)}?`);
    if (!yes) return;

    const { ok, data } = await postJson("/api/vendor/inventory-units/delete", {
      productId,
      ids: [u.id],
    });

    if (!ok) {
      toast.error(data?.error || "Delete failed");
      return;
    }

    toast.success("Unit deleted");
    await loadAll();
  };

  // Override delete of a verified unit. Gated by an explicit typed
  // confirmation ("DELETE"); the server endpoint enforces owner/manager
  // authorization (assertVendorWriter) and scopes deletion to this vendor.
  const runOverrideDelete = async () => {
    if (!overrideTarget || !vendor?.id) return;

    if (overrideConfirm.trim().toUpperCase() !== "DELETE") {
      toast.error('Type "DELETE" to confirm');
      return;
    }

    setOverrideWorking(true);
    try {
      const { ok, data } = await postJson("/api/vendor/inventory-units/delete", {
        productId,
        ids: [overrideTarget.id],
      });

      if (!ok) {
        toast.error(data?.error || "Override delete failed");
        return;
      }

      toast.success("Verified unit deleted");
      setOverrideDeleteOpen(false);
      setOverrideTarget(null);
      setOverrideConfirm("");
      await loadAll();
    } finally {
      setOverrideWorking(false);
    }
  };

  useEffect(() => {
    if (overrideDeleteOpen) {
      // clear the typed confirmation every time the dialog opens
      setOverrideConfirm("");
    }
  }, [overrideDeleteOpen]);

  // ---------------- Status updates (single row list) ----------------
  // ✅ Status changes should NOT require override auth (per requirement).
  const updateStatusDirect = async (u: UnitRow, next: InventoryStatus) => {
    if (!vendor?.id) return;
    if (u.status === next) return;

    // ✅ SOLD/DEMO can be reverted without admin.
    // If reverting to IN_STOCK, clear any customer pointers stored on the unit.
    if (next === "IN_STOCK" && (u.status === "SOLD" || u.status === "DEMO")) {
      setUpdatingId(u.id);

      // optimistic
      setUnits((prev) =>
        prev.map((x) =>
          x.id === u.id
            ? {
                ...x,
                status: next,
                sold_customer_id: null,
                sold_customer_name: null,
                sold_customer_phone: null,
                demo_customer_id: null,
                demo_customer_name: null,
                demo_customer_phone: null,
                demo_at: null,
              }
            : x,
        ),
      );

      const { ok, data } = await postJson("/api/vendor/inventory-units/status", {
        ids: [u.id],
        productId,
        status: next,
      });

      if (!ok) {
        setUnits((prev) =>
          prev.map((x) => (x.id === u.id ? { ...x, status: u.status } : x)),
        );
        setUpdatingId(null);
        toast.error(data?.error || "Status update failed");
        return;
      }

      toast.success("Reverted to IN_STOCK");
      await loadAll();
      setUpdatingId(null);
      return;
    }

    // ✅ SOLD: no auth. Collect customer details, then mark SOLD.
    if (next === "SOLD") {
      setSoldTargetUnit(u);
      resetSoldForm();

      if (u.sold_customer_name) setCustName(u.sold_customer_name ?? "");
      if (u.sold_customer_phone) setCustPhone(u.sold_customer_phone ?? "");

      setSoldDialogOpen(true);
      return;
    }

    // ✅ DEMO: no auth. Collect customer details, then mark DEMO.
    if (next === "DEMO") {
      setDemoTargetUnit(u);
      resetSoldForm();

      if (u.demo_customer_name) setCustName(u.demo_customer_name ?? "");
      if (u.demo_customer_phone) setCustPhone(u.demo_customer_phone ?? "");

      setDemoDialogOpen(true);
      return;
    }

    // 🔒 Keep RETURNED protected (unchanged behavior)
    if (next === "RETURNED") {
      openStatusOverride(u, next);
      return;
    }

    setUpdatingId(u.id);

    // optimistic (list)
    setUnits((prev) =>
      prev.map((x) => (x.id === u.id ? { ...x, status: next } : x)),
    );

    const { ok, data } = await postJson("/api/vendor/inventory-units/status", {
      ids: [u.id],
      productId,
      status: next,
    });

    if (!ok) {
      setUnits((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, status: u.status } : x)),
      );
      setUpdatingId(null);
      toast.error(data?.error || "Status update failed");
      return;
    }

    toast.success(`Status updated to ${next}`);
    await loadAll();
    setUpdatingId(null);
  };

  // ---------------- Status updates (scanned unit) ----------------
  // ✅ Status changes should NOT require override auth (per requirement).
  const updateScannedStatus = async (next: InventoryStatus) => {
    if (!vendor?.id || !scannedUnit) return;
    if (scannedUnit.status === next) return;

    // ✅ Revert SOLD/DEMO to IN_STOCK without auth; clear stored pointers.
    if (
      next === "IN_STOCK" &&
      (scannedUnit.status === "SOLD" || scannedUnit.status === "DEMO")
    ) {
      setScanLoading(true);
      const prev = scannedUnit.status;
      setScannedUnit({
        ...scannedUnit,
        status: next,
        sold_customer_id: null,
        sold_customer_name: null,
        sold_customer_phone: null,
        demo_customer_id: null,
        demo_customer_name: null,
        demo_customer_phone: null,
        demo_at: null,
      });

      const { ok, data } = await postJson("/api/vendor/inventory-units/status", {
        ids: [scannedUnit.id],
        productId,
        status: next,
      });

      if (!ok) {
        setScannedUnit({ ...scannedUnit, status: prev });
        setScanLoading(false);
        toast.error(data?.error || "Failed to update status");
        return;
      }

      toast.success("Reverted to IN_STOCK");
      setScanLoading(false);
      await loadAll();
      return;
    }

    // ✅ SOLD: no auth. Collect customer details, then mark SOLD.
    if (next === "SOLD") {
      setSoldTargetUnit(scannedUnit);
      resetSoldForm();

      if (scannedUnit.sold_customer_name)
        setCustName(scannedUnit.sold_customer_name ?? "");
      if (scannedUnit.sold_customer_phone)
        setCustPhone(scannedUnit.sold_customer_phone ?? "");

      setSoldDialogOpen(true);
      return;
    }

    // ✅ DEMO: no auth. Collect customer details, then mark DEMO.
    if (next === "DEMO") {
      setDemoTargetUnit(scannedUnit);
      resetSoldForm();

      if (scannedUnit.demo_customer_name)
        setCustName(scannedUnit.demo_customer_name ?? "");
      if (scannedUnit.demo_customer_phone)
        setCustPhone(scannedUnit.demo_customer_phone ?? "");

      setDemoDialogOpen(true);
      return;
    }

    // 🔒 Keep RETURNED protected (unchanged behavior)
    if (next === "RETURNED") {
      openStatusOverride(scannedUnit, next);
      return;
    }

    setScanLoading(true);
    const prev = scannedUnit.status;
    setScannedUnit({ ...scannedUnit, status: next });

    const { ok, data } = await postJson("/api/vendor/inventory-units/status", {
      ids: [scannedUnit.id],
      productId,
      status: next,
    });

    if (!ok) {
      setScannedUnit({ ...scannedUnit, status: prev });
      setScanLoading(false);
      toast.error(data?.error || "Failed to update status");
      return;
    }

    toast.success(`Updated status to ${next}`);
    setScanLoading(false);
    await loadAll();
  };

  // ---------------- Scan: lookup unit by code ----------------
// U1 only adds dual-code groundwork. Visible grouped scan behavior comes in U3.
  const lookupScannedUnit = async (raw?: string) => {
    if (!vendor?.id) return;

    const code = (raw ?? scanValue).trim();
    if (!code) return;

    setScanLoading(true);
    try {
      const res = await fetch(
        `/api/vendor/inventory-units?mode=scan&productId=${encodeURIComponent(productId)}&code=${encodeURIComponent(code)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || "Scan lookup failed");

      const data = body.data;
      if (!data) {
        setScannedUnit(null);
        toast.error("Unit not found for this product");
        return;
      }

      setScannedUnit(data as any);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Scan lookup failed");
    } finally {
      setScanLoading(false);
      setTimeout(() => {
        scanInputRef.current?.focus();
        scanInputRef.current?.select();
      }, 60);
    }
  };

  // ---------------- Customer suggestions ----------------
  useEffect(() => {
    if (!soldDialogOpen || !vendor?.id) return;

    const q = custQuery.trim();
    if (q.length < 2) {
      setCustSuggestions([]);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      setCustLoading(true);
      try {
        const res = await fetch(
          `/api/vendor/customers?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        );
        const body = await res.json();

        if (cancelled) return;

        if (!res.ok || !body?.ok) {
          console.warn(body?.error);
          setCustSuggestions([]);
        } else {
          setCustSuggestions((body.data ?? []) as any);
        }
      } finally {
        if (!cancelled) setCustLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [custQuery, soldDialogOpen, vendor?.id]);

  const chooseSuggestion = (c: CustomerRow) => {
    setSelectedCustomerId(c.id);
    setCustName(c.name ?? "");
    setCustPhone(c.phone ?? "");
    setCustEmail(c.email ?? "");
    setCustAddress(c.address ?? "");
    setCustSuggestions([]);
    setCustQuery(c.name ?? "");
  };

  const resolveOrCreateCustomer = async (): Promise<string | null> => {
    if (!vendor?.id) return null;

    const name = custName.trim();
    const phone = custPhone.trim();
    const email = custEmail.trim();
    const address = custAddress.trim();

    if (!name) {
      toast.error("Customer name is required");
      return null;
    }

    // Vendor-scoped resolve-or-create (dedupe by phone/email server-side).
    const { ok, data } = await postJson("/api/vendor/customers", {
      name,
      phone,
      email,
      address,
      selectedId: selectedCustomerId,
    });

    if (!ok || !data?.id) {
      toast.error(data?.error || "Failed to save customer");
      return null;
    }

    return data.id as string;
  };

  const saveSoldWithCustomer = async () => {
    if (!vendor?.id || !soldTargetUnit) return;

    const name = custName.trim();
    const phone = custPhone.trim();

    const customerId = await resolveOrCreateCustomer();
    if (!customerId) return;

    setUpdatingId(soldTargetUnit.id);
    try {
      const { ok, data } = await postJson("/api/vendor/inventory-units/status", {
        ids: [soldTargetUnit.id],
        productId,
        status: "SOLD",
        sold: { id: customerId, name, phone },
      });

      if (!ok) {
        toast.error(data?.error || "Failed to mark SOLD");
        return;
      }

      toast.success("Marked SOLD with customer details");

      if (scannedUnit?.id === soldTargetUnit.id) {
        setScannedUnit((prev) =>
          prev
            ? {
                ...prev,
                status: "SOLD",
                sold_customer_name: name,
                sold_customer_phone: phone || null,
              }
            : prev,
        );
      }

      setSoldDialogOpen(false);
      setSoldTargetUnit(null);
      resetSoldForm();
      await loadAll();
    } finally {
      setUpdatingId(null);
    }
  };

  // ---------------- Export helpers ----------------
  const buildCsv = (rows: UnitRow[]) => {
    if (!product) return "";

    const header = ["code", "product_name", "mrp", "verified"];
    const lines = [header.join(",")];

    const mrp = product.sale_price ?? "";

    for (const u of rows) {
      lines.push(
        [
          csvEscape(getVisibleUnitCode(u)),
          csvEscape(product.name),
          csvEscape(mrp),
          csvEscape(u.is_verified ? "YES" : "NO"),
        ].join(","),
      );
    }

    return lines.join("\n");
  };

  const downloadCsv = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCurrentPage = async () => {
    if (!product) return toast.error("Product not loaded yet");
    const csv = buildCsv(units);
    const safeName = product.name.replace(/[^\w\-]+/g, "_");
    downloadCsv(csv, `units_page_${safeName}_${toYmd(new Date())}.csv`);
    toast.success(`Exported ${units.length} units (current page)`);
  };

  const exportFilteredAll = async () => {
    if (!vendor?.id) return;
    if (!product) return toast.error("Product not loaded yet");

    setExporting(true);
    try {
      const qp = buildUnitFilterParams();
      qp.set("mode", "export");
      const res = await fetch(`/api/vendor/inventory-units?${qp.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        toast.error(body?.error || "Export failed");
        return;
      }
      const all = (body.data ?? []) as any as UnitRow[];

      const csv = buildCsv(all);
      const safeName = product.name.replace(/[^\w\-]+/g, "_");
      downloadCsv(csv, `units_filtered_${safeName}_${toYmd(new Date())}.csv`);
      toast.success(`Exported ${all.length} units (filtered)`);
    } finally {
      setExporting(false);
    }
  };

  const exportSelected = async () => {
    if (!product) return toast.error("Product not loaded yet");
    if (selectedIds.size === 0) return toast.error("No units selected");

    setExporting(true);
    try {
      const rows = await fetchSelectedUnits();
      if (rows.length === 0) return;

      const csv = buildCsv(rows);
      const safeName = product.name.replace(/[^\w\-]+/g, "_");
      downloadCsv(csv, `units_selected_${safeName}_${toYmd(new Date())}.csv`);
      toast.success(`Exported ${rows.length} selected units`);
    } finally {
      setExporting(false);
    }
  };

  // ---------------- Bulk delete handler ----------------
  const runBulkDelete = async () => {
    if (!vendor?.id) return;

    if (!bulkDeleteName.trim()) {
      toast.error("Enter your name to continue");
      return;
    }

    if (!bulkDeleteAck) {
      toast.error("Please acknowledge the deletion");
      return;
    }

    const hasVerified = bulkDeleteVerifiedCount > 0;
    const skippingVerified = hasVerified && bulkDeleteMode === "SKIP_VERIFIED";

    // ✅ If skipping verified: no admin needed, delete only non-verified
    if (skippingVerified) {
      if (bulkDeleteConfirm.trim().toUpperCase() !== "DELETE") {
        toast.error('Type "DELETE" to confirm');
        return;
      }

      setBulkDeleting(true);
      try {
        let totalTarget =
          bulkDeleteScope === "SELECTED" ? selectedIds.size : totalCount;

        const filtersPayload =
          bulkDeleteScope === "FILTERED"
            ? {
                search,
                statusFilter,
                mfgFrom,
                mfgTo,
                expFrom,
                expTo,
                includeNoExpiry,
                expiredFilter,
                today: todayYmd,
              }
            : null;

        const selectedIdsArr = Array.from(selectedIds);
        if (bulkDeleteScope === "SELECTED" && selectedIdsArr.length === 0) {
          toast.error("No units selected");
          return;
        }

        // Server enforces the verified guard (is_verified=false) and writes the
        // audit row in one transaction, scoped to this vendor + product.
        const { ok, data } = await postJson(
          "/api/vendor/inventory-units/delete",
          {
            productId,
            verifiedGuard: true,
            ...(bulkDeleteScope === "SELECTED"
              ? { ids: selectedIdsArr }
              : { filters: filtersPayload }),
            audit: {
              scope: bulkDeleteScope,
              total_units: totalTarget,
              verified_units: bulkDeleteVerifiedCount,
              skipped_verified_units: bulkDeleteVerifiedCount,
              deleted_by_name: bulkDeleteName.trim(),
              is_admin_override: false,
              filters: filtersPayload,
              selected_ids:
                bulkDeleteScope === "SELECTED" ? selectedIdsArr : null,
            },
          },
        );

        if (!ok) {
          toast.error(data?.error || "Bulk delete failed");
          return;
        }

        const deletedCount = Number(data?.count ?? 0);
        if (deletedCount === 0) {
          toast.info("All selected units are verified. Nothing deleted.");
        }
        setSelectedIds(new Set());

        toast.success(
          `Deleted ${deletedCount} units (skipped verified: ${bulkDeleteVerifiedCount})`,
        );

        setBulkDeleteOpen(false);
        setBulkDeleteConfirm("");
        setBulkDeleteAck(false);
        setBulkDeleteName("");
        setBulkDeleteMode("DELETE_ALL");

        setPage(1);
        await loadAll();
      } finally {
        setBulkDeleting(false);
      }

      return;
    }

    // If verified units exist AND mode is DELETE_ALL => require the typed
    // "DELETE" confirmation. The server enforces owner/manager authorization.
    if (hasVerified) {
      if (bulkDeleteConfirm.trim().toUpperCase() !== "DELETE") {
        toast.error('Type "DELETE" to confirm (verified units included)');
        return;
      }

      setBulkDeleting(true);
      try {
        let totalTarget =
          bulkDeleteScope === "SELECTED" ? selectedIds.size : totalCount;

        const filtersPayload =
          bulkDeleteScope === "FILTERED"
            ? {
                search,
                statusFilter,
                mfgFrom,
                mfgTo,
                expFrom,
                expTo,
                includeNoExpiry,
                expiredFilter,
                today: todayYmd,
              }
            : null;

        const selectedIdsArr = Array.from(selectedIds);
        if (bulkDeleteScope === "SELECTED" && selectedIdsArr.length === 0) {
          toast.error("No units selected");
          return;
        }

        // Delete EVERYTHING in scope (verified included). The typed "DELETE"
        // confirmation above is the client gate; the server deletes within
        // this vendor + product and writes the audit row.
        const { ok, data } = await postJson(
          "/api/vendor/inventory-units/delete",
          {
            productId,
            ...(bulkDeleteScope === "SELECTED"
              ? { ids: selectedIdsArr }
              : { filters: filtersPayload }),
            audit: {
              scope: bulkDeleteScope,
              total_units: totalTarget,
              verified_units: bulkDeleteVerifiedCount,
              skipped_verified_units: 0,
              deleted_by_name: bulkDeleteName.trim(),
              is_admin_override: true,
              filters: filtersPayload,
              selected_ids:
                bulkDeleteScope === "SELECTED" ? selectedIdsArr : null,
            },
          },
        );

        if (!ok) {
          toast.error(data?.error || "Bulk delete failed");
          return;
        }

        const deletedCount = Number(data?.count ?? 0);
        setSelectedIds(new Set());

        toast.success(
          `Deleted ${deletedCount} units (verified included: ${bulkDeleteVerifiedCount})`,
        );

        setBulkDeleteOpen(false);
        setBulkDeleteConfirm("");
        setBulkDeleteAck(false);
        setBulkDeleteName("");
        setBulkDeleteMode("DELETE_ALL");

        setPage(1);
        await loadAll();
      } finally {
        setBulkDeleting(false);
      }

      return;
    }

    // No verified units => normal delete confirmation typing DELETE
    if (bulkDeleteConfirm.trim().toUpperCase() !== "DELETE") {
      toast.error('Type "DELETE" to confirm');
      return;
    }

    setBulkDeleting(true);
    try {
      let totalTarget =
        bulkDeleteScope === "SELECTED" ? selectedIds.size : totalCount;

      const filtersPayload =
        bulkDeleteScope === "FILTERED"
          ? {
              search,
              statusFilter,
              mfgFrom,
              mfgTo,
              expFrom,
              expTo,
              includeNoExpiry,
              expiredFilter,
              today: todayYmd,
            }
          : null;

      const selectedIdsArr = Array.from(selectedIds);
      if (bulkDeleteScope === "SELECTED" && selectedIdsArr.length === 0) {
        toast.error("No units selected");
        return;
      }

      const { ok, data } = await postJson("/api/vendor/inventory-units/delete", {
        productId,
        ...(bulkDeleteScope === "SELECTED"
          ? { ids: selectedIdsArr }
          : { filters: filtersPayload }),
        audit: {
          scope: bulkDeleteScope,
          total_units: totalTarget,
          verified_units: 0,
          skipped_verified_units: 0,
          deleted_by_name: bulkDeleteName.trim(),
          is_admin_override: false,
          filters: filtersPayload,
          selected_ids: bulkDeleteScope === "SELECTED" ? selectedIdsArr : null,
        },
      });

      if (!ok) {
        toast.error(data?.error || "Bulk delete failed");
        return;
      }

      const deletedCount = Number(data?.count ?? 0);
      if (bulkDeleteScope === "SELECTED") {
        toast.success(`Deleted ${deletedCount} selected units`);
      } else {
        toast.success("Deleted filtered units");
      }
      setSelectedIds(new Set());

      setBulkDeleteOpen(false);
      setBulkDeleteConfirm("");
      setBulkDeleteAck(false);
      setBulkDeleteName("");
      setBulkDeleteMode("DELETE_ALL");

      setPage(1);
      await loadAll();
    } finally {
      setBulkDeleting(false);
    }
  };

  // ---------------- Bulk edit handler (status + dates) ----------------
  const runBulkEdit = async () => {
    if (!vendor?.id) return;

    const patch: Record<string, any> = {};

    if (bulkNewStatus !== "NO_CHANGE") {
      if (bulkNewStatus === "SOLD") {
        toast.error(
          'Bulk set to "SOLD" is not allowed (needs customer details).',
        );
        return;
      }
      patch.status = bulkNewStatus;
    }

    if (bulkNewMfgDate.trim() !== "") patch.manufacture_date = bulkNewMfgDate;
    if (bulkNewExpDate.trim() !== "") patch.expiry_date = bulkNewExpDate;

    if (Object.keys(patch).length === 0) {
      toast.error("Nothing to update");
      return;
    }

    setBulkEditing(true);
    try {
      if (bulkEditScope === "SELECTED") {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
          toast.error("No units selected");
          return;
        }

        const { ok, data } = await postJson(
          "/api/vendor/inventory-units/update",
          { ids, productId, patch },
        );
        if (!ok) {
          toast.error(data?.error || "Bulk edit failed");
          return;
        }

        toast.success(`Updated ${ids.length} selected units`);
      } else {
        // FILTERED scope: resolve the matching ids first via the export reader,
        // then update them (both vendor-scoped).
        const qp = buildUnitFilterParams();
        qp.set("mode", "export");
        const res = await fetch(
          `/api/vendor/inventory-units?${qp.toString()}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!res.ok || !body?.ok) {
          toast.error(body?.error || "Bulk edit failed");
          return;
        }
        const ids = ((body.data ?? []) as any[]).map((r) => r.id);
        if (ids.length === 0) {
          toast.info("No matching units to update");
        } else {
          const { ok, data } = await postJson(
            "/api/vendor/inventory-units/update",
            { ids, productId, patch },
          );
          if (!ok) {
            toast.error(data?.error || "Bulk edit failed");
            return;
          }
        }

        toast.success("Updated filtered units");
      }

      setBulkEditOpen(false);
      setBulkNewStatus("NO_CHANGE");
      setBulkNewMfgDate("");
      setBulkNewExpDate("");
      await loadAll();
    } finally {
      setBulkEditing(false);
    }
  };

  // ---------------- Filter modal apply/clear ----------------
  const applyFilters = () => {
    setPage(1);
    setFiltersVersion((x) => x + 1);
    setFiltersOpen(false);
  };

  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("ALL");
    setMfgFrom("");
    setMfgTo("");
    setExpFrom("");
    setExpTo("");
    setIncludeNoExpiry(true);
    setSelectedIds(new Set());
    setPage(1);
    setFiltersVersion((x) => x + 1);
    setFiltersOpen(false);
  };

  if (!hydrated) return null;

  return (
    <div className="space-y-4">
      <ToastContainer position="top-right" autoClose={2500} />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">
              Units — {product?.name ?? "Product"}
            </CardTitle>

            {activeFilterSummary.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                Active filters: <b>{activeFilterSummary.join(" • ")}</b>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No filters applied
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={() => router.back()}>
              Back
            </Button>

            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setStatusFilter("ALL");
                setMfgFrom("");
                setMfgTo("");
                setExpFrom("");
                setExpTo("");
                setIncludeNoExpiry(true);
                setSelectedIds(new Set());
                setPage(1);
                setFiltersVersion((x) => x + 1);
                toast.success("Refreshed");
              }}
              disabled={!ready}
              title="Clear filters and refresh"
            >
              Refresh
            </Button>

            <Button
              variant="outline"
              onClick={openInvoiceMultiFromSelected}
              disabled={selectedIds.size === 0 || !product}
              title="Create one invoice with multiple selected SOLD units"
            >
              Create Invoice (Selected){" "}
              {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
            </Button>

            {isAdmin && selectedIds.size > 0 ? (
              <Button
                variant="outline"
                onClick={openTransferDialog}
                disabled={selectedIds.size === 0 || !product}
                title="Move the selected units to another product"
              >
                Transfer to product ({selectedIds.size})
              </Button>
            ) : null}

            <Button
              variant="outline"
              onClick={() => {
                setScanOpen(true);
                setScannedUnit(null);
                setTimeout(() => {
                  scanInputRef.current?.focus();
                  scanInputRef.current?.select();
                }, 80);
              }}
              disabled={!ready || !vendor?.id}
              title="Scan unit code to open the unit details"
            >
              Scan Unit
            </Button>

            <Button
              variant="outline"
              onClick={() => setFiltersOpen(true)}
              disabled={!ready}
              title="Open filters"
            >
              Filters
            </Button>

            <Button
              variant="outline"
              onClick={() => setExportOpen(true)}
              disabled={!product}
              title="Export options"
            >
              Export
            </Button>

            <Button onClick={() => setCreateOpen(true)}>Add units</Button>

            <Button
              variant="destructive"
              onClick={() => {
                const scope = selectedIds.size > 0 ? "SELECTED" : "FILTERED";
                setBulkDeleteScope(scope);
                setBulkDeleteConfirm("");
                setBulkDeleteAck(false);
                setBulkDeleteName("");
                setBulkDeleteMode("DELETE_ALL");
                setBulkDeleteOpen(true);
                computeBulkDeleteMeta(scope);
              }}
              disabled={totalCount === 0}
              title="Bulk delete"
            >
              Bulk Delete {selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Product Code: <b>{product?.product_code ?? "-"}</b>
            {brand ? (
              <>
                {" "}
                • Brand Code: <b>{brand.brand_code ?? "-"}</b>
              </>
            ) : null}{" "}
            • Expired on this page: <b>{expiredCountThisPage}</b>
            {selectedIds.size > 0 ? (
              <>
                {" "}
                • Selected: <b>{selectedIds.size}</b>
              </>
            ) : null}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
            <div>
              In stock: <b>{countsAll.IN_STOCK}</b>
            </div>
            <div>
              Demo: <b>{countsAll.DEMO}</b>
            </div>
            <div>
              Sold: <b>{countsAll.SOLD}</b>
            </div>
            <div>
              Returned: <b>{countsAll.RETURNED}</b>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center pt-2">
            <div className="text-xs text-muted-foreground">
              Search unit code
            </div>
            <div className="flex gap-2 w-full sm:max-w-[520px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPage(1);
                    setFiltersVersion((x) => x + 1);
                  }
                }}
                placeholder="Type unit code and press Enter…"
              />
              <Button
                variant="outline"
                onClick={() => {
                  setPage(1);
                  setFiltersVersion((x) => x + 1);
                }}
                disabled={!ready}
              >
                Search
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                  setFiltersVersion((x) => x + 1);
                }}
                disabled={!ready}
              >
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3">
            <div className="text-sm text-muted-foreground">
              Total: <b>{totalCount}</b> • Page <b>{page}</b> /{" "}
              <b>{totalPages}</b>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <div className="text-sm text-muted-foreground">Rows</div>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  const n = Number(v) as 20 | 50 | 100;
                  setPageSize(n);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <Select
              value={expiredFilter}
              onValueChange={(v) => {
                setExpiredFilter(v as any);
                setPage(1);
                setFiltersVersion((x) => x + 1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background">
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="EXPIRED">Expired only</SelectItem>
                <SelectItem value="NOT_EXPIRED">Not expired</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={sortBy}
              onValueChange={(v) => {
                setSortBy(v as any);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent className="bg-background">
                <SelectItem value="created_desc">Created: Newest</SelectItem>
                <SelectItem value="created_asc">Created: Oldest</SelectItem>
                <SelectItem value="exp_asc">Expiry: Earliest</SelectItem>
                <SelectItem value="exp_desc">Expiry: Latest</SelectItem>
                <SelectItem value="mfg_desc">MFG: Newest</SelectItem>
                <SelectItem value="mfg_asc">MFG: Oldest</SelectItem>
                <SelectItem value="code_asc">Unit code: A–Z</SelectItem>
                <SelectItem value="code_desc">Unit code: Z–A</SelectItem>
              </SelectContent>
            </Select>

            {expiredCountThisPage > 0 ? (
              <span className="text-xs px-2 py-1 rounded-md border bg-muted">
                Expired: <b>{expiredCountThisPage}</b>
              </span>
            ) : null}
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <input
                      type="checkbox"
                      checked={allSelectedOnPage}
                      onChange={(e) => toggleSelectAllOnPage(e.target.checked)}
                      aria-label="Select all on page"
                    />
                  </TableHead>
                  <TableHead>Unit code</TableHead>
                  <TableHead>MFG</TableHead>
                  <TableHead>EXP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {units.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-sm text-muted-foreground"
                    >
                      No units found.
                    </TableCell>
                  </TableRow>
                ) : (
                  units.map((u) => {
                    const exp = u.expiry_date
                      ? String(u.expiry_date).slice(0, 10)
                      : null;
                    const expired = !!(exp && exp < todayYmd);

                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(u.id)}
                            onChange={(e) =>
                              toggleSelect(u.id, e.target.checked)
                            }
                            aria-label={`Select ${getVisibleUnitCode(u)}`}
                          />
                        </TableCell>

                        <TableCell className="font-mono">
                          {getVisibleUnitCode(u)}
                          <div className="flex items-center gap-2 flex-wrap">
                            {isSharedScanUnit(u) ? (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-muted">
                                SHARED CODE
                              </span>
                            ) : null}
                            {u.is_verified ? (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-muted">
                                VERIFIED
                              </span>
                            ) : null}
                          </div>
                          {isSharedScanUnit(u) ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              Remaining in stock: {sharedCodeRemaining[getVisibleUnitCode(u)] ?? 0}
                            </div>
                          ) : null}
                        </TableCell>

                        <TableCell>{u.manufacture_date ?? "-"}</TableCell>
                        <TableCell>{u.expiry_date ?? "-"}</TableCell>

                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center flex-wrap gap-2">
                            <UnitStatusBadge
                              status={u.status}
                              expired={expired}
                            />

                            {(() => {
                              const directName =
                                u.status === "SOLD"
                                  ? u.sold_customer_name
                                  : u.status === "DEMO"
                                    ? (u as any).demo_customer_name
                                    : null;
                              const directPhone =
                                u.status === "SOLD"
                                  ? u.sold_customer_phone
                                  : u.status === "DEMO"
                                    ? (u as any).demo_customer_phone
                                    : null;

                              if (directName || directPhone) {
                                return (
                                  <span className="text-xs text-muted-foreground">
                                    • {directName ?? "Customer"}
                                    {directPhone ? ` (${directPhone})` : ""}
                                  </span>
                                );
                              }

                              // Fallback: pull customer details from the invoice
                              // this unit is included in (for SOLD/DEMO/RETURNED units
                              // that don't carry customer info on the unit row).
                              if (
                                u.status === "SOLD" ||
                                u.status === "DEMO" ||
                                u.status === "RETURNED"
                              ) {
                                const inv = unitInvoiceCustomers[u.id];
                                if (inv && (inv.name || inv.phone)) {
                                  return (
                                    <span className="text-xs text-muted-foreground">
                                      • {inv.name ?? "Customer"}
                                      {inv.phone ? ` (${inv.phone})` : ""}
                                      {inv.invoice_number
                                        ? ` — Inv ${inv.invoice_number}`
                                        : ""}
                                    </span>
                                  );
                                }
                              }

                              return null;
                            })()}

                            {(u.status === "SOLD" || u.status === "DEMO") &&
                            ((u as any).sold_customer_id ||
                              (u as any).demo_customer_id ||
                              u.sold_customer_id ||
                              u.demo_customer_id) ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => openCustomerDetails(u)}
                              >
                                View customer
                              </Button>
                            ) : null}

                            <Select
                              value={u.status}
                              onValueChange={(v) =>
                                updateStatusDirect(u, v as InventoryStatus)
                              }
                              disabled={updatingId === u.id}
                            >
                              <SelectTrigger className="h-8 w-[170px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent
                                position="popper"
                                side="bottom"
                                align="start"
                                sideOffset={6}
                                className="z-[200] bg-background text-foreground border shadow-lg p-1"
                              >
                                <SelectItem value="IN_STOCK">
                                  IN_STOCK
                                </SelectItem>
                                {/* <SelectItem value="INVOICED">
                                  INVOICED
                                </SelectItem> */}
                                <SelectItem value="DEMO">DEMO</SelectItem>
                                <SelectItem value="SOLD">SOLD</SelectItem>
                                <SelectItem value="RETURNED">
                                  RETURNED
                                </SelectItem>
                              </SelectContent>
                            </Select>

                            {updatingId === u.id ? (
                              <span className="text-xs text-muted-foreground">
                                Updating…
                              </span>
                            ) : null}
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {!u.is_verified ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => markVerified(u)}
                              >
                                Verify
                              </Button>
                            ) : null}

                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openInvoiceSingle(u)}
                              disabled={u.status !== "SOLD"}
                              title={
                                u.status !== "SOLD"
                                  ? "Only SOLD units can be invoiced"
                                  : "Create invoice for this unit"
                              }
                            >
                              Invoice
                            </Button>

                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => deleteUnit(u)}
                            >
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-end gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Create */}
      {vendor?.id ? (
        <UnitUpsertDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          vendorId={vendor.id}
          productId={productId}
          onSaved={() => {
            setPage(1);
            loadAll();
          }}
        />
      ) : null}

      {/* Edit */}
      {vendor?.id && editUnit ? (
        <UnitUpsertDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          vendorId={vendor.id}
          productId={productId}
          initial={editUnit as any}
          onSaved={() => loadAll()}
        />
      ) : null}

      {/* ✅ Scan Modal */}
      <Dialog
        open={scanOpen}
        onOpenChange={(v) => {
          setScanOpen(v);
          if (!v) setScannedUnit(null);
        }}
      >
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Scan unit</DialogTitle>
            <DialogDescription>
              Plug in your scanner, click inside the box, and scan. (Most
              scanners type the code + press Enter automatically.)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground mb-2">
                Scan cursor area
              </div>

              <div className="flex gap-2">
                <Input
                  ref={scanInputRef}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      lookupScannedUnit();
                    }
                  }}
                  placeholder="Scan / type unit code and press Enter…"
                  className="h-12 text-base font-mono"
                />
                <Button
                  onClick={() => lookupScannedUnit()}
                  disabled={!scanValue.trim() || scanLoading}
                  className="h-12"
                >
                  {scanLoading ? "Checking…" : "Lookup"}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetScan}
                  disabled={scanLoading}
                >
                  Clear
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    scanInputRef.current?.focus();
                    scanInputRef.current?.select();
                  }}
                  disabled={scanLoading}
                >
                  Focus
                </Button>
              </div>
            </div>

            {scannedUnit ? (
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Unit</div>
                    <div className="text-lg font-mono font-semibold">
                      {getVisibleUnitCode(scannedUnit)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      MFG: <b>{scannedUnit.manufacture_date ?? "-"}</b> • EXP:{" "}
                      <b>{scannedUnit.expiry_date ?? "-"}</b> • Price:{" "}
                      <b>{scannedUnit.price ?? "-"}</b>
                    </div>
                    {isSharedScanUnit(scannedUnit) ? (
                      <>
                        <div className="text-xs text-muted-foreground mt-1">
                          New grouped flow detected. Public code shown; internal suffix stays hidden.
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Remaining in stock for this code: {sharedCodeRemaining[getVisibleUnitCode(scannedUnit)] ?? 0}
                        </div>
                      </>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => openInvoiceSingle(scannedUnit)}
                      disabled={
                        !product || !vendor || scannedUnit.status !== "SOLD"
                      }
                      title={
                        scannedUnit.status !== "SOLD"
                          ? "Mark SOLD first"
                          : "Create invoice for this unit"
                      }
                    >
                      Create Invoice
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearch(getVisibleUnitCode(scannedUnit));
                        setPage(1);
                        setFiltersVersion((x) => x + 1);
                        toast.success("Applied scanned unit to list filter");
                        setScanOpen(false);
                      }}
                      title="Filter list by this unit"
                    >
                      Show in List
                    </Button>
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-2">
                  <UnitStatusBadge
                    status={scannedUnit.status}
                    expired={
                      !!(
                        scannedUnit.expiry_date &&
                        String(scannedUnit.expiry_date).slice(0, 10) < todayYmd
                      )
                    }
                  />

                  <div className="w-[220px]">
                    <Select
                      value={scannedUnit.status}
                      onValueChange={(v) =>
                        updateScannedStatus(v as InventoryStatus)
                      }
                      disabled={scanLoading}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background">
                        <SelectItem value="IN_STOCK">IN_STOCK</SelectItem>
                        <SelectItem value="DEMO">DEMO</SelectItem>
                        <SelectItem value="SOLD">SOLD</SelectItem>
                        <SelectItem value="RETURNED">RETURNED</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {scannedUnit.status === "SOLD" &&
                  (scannedUnit.sold_customer_name ||
                    scannedUnit.sold_customer_phone) ? (
                    <span className="text-xs text-muted-foreground">
                      • {scannedUnit.sold_customer_name ?? "Customer"}{" "}
                      {scannedUnit.sold_customer_phone
                        ? `(${scannedUnit.sold_customer_phone})`
                        : ""}
                    </span>
                  ) : null}
                </div>

                <div className="text-xs text-muted-foreground">
                  Tip: After updating status, keep scanning the next unit —
                  cursor stays in the scan box.
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setScanOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Invoice Modal (scrollable + PDF print/download fixed) */}
      <Dialog
        open={invoiceOpen}
        onOpenChange={(v) => {
          setInvoiceOpen(v);
          if (!v) resetInvoiceDraft();
        }}
      >
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle>
              {invoiceMode === "SINGLE"
                ? "Create Invoice (Single Unit)"
                : "Create Invoice (Multiple Units)"}
            </DialogTitle>
            <DialogDescription>
              {invoiceMode === "SINGLE"
                ? "Single invoice is restricted to exactly one unit."
                : "Multi invoice: you can edit lines before creating."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Top: Company + Date + Type */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Invoice Company *
                </div>
                <Select
                  value={invoiceCompanyId}
                  onValueChange={setInvoiceCompanyId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select company..." />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    {invoiceCompanies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.display_name} ({c.key})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Invoice Date
                </div>
                <Input
                  type="date"
                  value={invInvoiceDate}
                  onChange={(e) => setInvInvoiceDate(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Invoice Type
                </div>
                <Select
                  value={invoicePrintType}
                  onValueChange={(v) => setInvoicePrintType(v as any)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    <SelectItem value="CUSTOMER">
                      Customer Invoice (No Unit Code)
                    </SelectItem>
                    <SelectItem value="ADMIN">
                      Admin Invoice (Include Unit Code)
                    </SelectItem>
                  </SelectContent>
                </Select>

                <div className="text-[11px] text-muted-foreground">
                  CUSTOMER: product name only • ADMIN: includes unit code in
                  description
                </div>
              </div>
            </div>

            {/* Seller GST/PAN */}
            <div className="rounded-md border p-3 space-y-3">
              <div className="text-sm font-medium">Seller Details</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    Seller GSTIN
                  </div>
                  <Input
                    value={invSellerGstin}
                    onChange={(e) => setInvSellerGstin(e.target.value)}
                    placeholder="Auto-filled from company (editable)"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    Seller PAN
                  </div>
                  <Input
                    value={invSellerPan}
                    onChange={(e) => setInvSellerPan(e.target.value)}
                    placeholder="Auto-filled from company (editable)"
                  />
                </div>
              </div>
            </div>

            {/* Customer */}
            <div className="rounded-md border p-3 space-y-3">
              <div className="text-sm font-medium">Bill To</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    Customer Name *
                  </div>
                  <Input
                    value={invCustomerName}
                    onChange={(e) => setInvCustomerName(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Phone</div>
                  <Input
                    value={invPhone}
                    onChange={(e) => setInvPhone(e.target.value)}
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <div className="text-xs text-muted-foreground">
                    Billing Address
                  </div>
                  <Input
                    value={invBillingAddress}
                    onChange={(e) => setInvBillingAddress(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Email</div>
                  <Input
                    value={invEmail}
                    onChange={(e) => setInvEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    Customer GSTIN
                  </div>
                  <Input
                    value={invGstNumber}
                    onChange={(e) => setInvGstNumber(e.target.value)}
                    placeholder="Optional"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    Customer PAN
                  </div>
                  <Input
                    value={invPanNumber}
                    onChange={(e) => setInvPanNumber(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Invoice Items</div>
                {invoiceMode === "SINGLE" ? (
                  <div className="text-xs text-muted-foreground">
                    Single mode: 1 line only
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Multi mode: edit lines
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[120px]">HSN</TableHead>
                      <TableHead className="w-[90px] text-right">Qty</TableHead>
                      <TableHead className="w-[130px] text-right">
                        Unit
                      </TableHead>
                      <TableHead className="w-[120px] text-right">
                        Discount
                      </TableHead>
                      <TableHead className="w-[90px] text-right">
                        Tax%
                      </TableHead>
                      <TableHead className="w-[90px] text-right">
                        Remove
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {invItems.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>
                          <Input
                            value={it.description}
                            onChange={(e) =>
                              setInvItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id
                                    ? { ...x, description: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                          <div className="text-[11px] text-muted-foreground mt-1">
                            PDF description will follow Invoice Type:{" "}
                            <b>
                              {invoicePrintType === "ADMIN"
                                ? "includes unit code"
                                : "product only"}
                            </b>
                          </div>
                        </TableCell>

                        <TableCell>
                          <Input
                            value={it.hsn_sac}
                            onChange={(e) =>
                              setInvItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id
                                    ? { ...x, hsn_sac: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </TableCell>

                        <TableCell className="text-right">
                          <Input type="number" value={it.quantity} disabled />
                        </TableCell>

                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={it.unit_price}
                            onChange={(e) =>
                              setInvItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id
                                    ? {
                                        ...x,
                                        unit_price: Number(e.target.value || 0),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </TableCell>

                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={it.discount}
                            onChange={(e) =>
                              setInvItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id
                                    ? {
                                        ...x,
                                        discount: Number(e.target.value || 0),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </TableCell>

                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={it.tax_percent}
                            onChange={(e) =>
                              setInvItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id
                                    ? {
                                        ...x,
                                        tax_percent: Number(
                                          e.target.value || 0,
                                        ),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </TableCell>

                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={invoiceMode === "SINGLE"}
                            onClick={() =>
                              setInvItems((prev) =>
                                prev.filter((x) => x.id !== it.id),
                              )
                            }
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-end gap-6 text-sm">
                <div>
                  Subtotal: <b>{invTotals.subtotal}</b>
                </div>
                <div>
                  Tax: <b>{invTotals.tax}</b>
                </div>
                <div>
                  Total: <b>{invTotals.total}</b>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Tax Label</div>
                  <Input
                    value={invTaxLabel}
                    onChange={(e) => setInvTaxLabel(e.target.value)}
                    placeholder="GST"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Notes</div>
                  <Input
                    value={invNotes}
                    onChange={(e) => setInvNotes(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setInvoiceOpen(false)}
              disabled={invWorking}
            >
              Cancel
            </Button>
            <Button onClick={createInvoiceNow} disabled={invWorking}>
              {invWorking ? "Generating…" : "Create PDF & Print"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Filters Modal */}
      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
            <DialogDescription>
              Set filters and click Apply. (Dates are optional.)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Status</div>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as any)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="IN_STOCK">IN_STOCK</SelectItem>
                    <SelectItem value="DEMO">DEMO</SelectItem>
                    <SelectItem value="SOLD">SOLD</SelectItem>
                    <SelectItem value="RETURNED">RETURNED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="text-sm font-medium">Manufacture Date Range</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">MFG From</div>
                  <Input
                    type="date"
                    value={mfgFrom}
                    onChange={(e) => setMfgFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">MFG To</div>
                  <Input
                    type="date"
                    value={mfgTo}
                    onChange={(e) => setMfgTo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="text-sm font-medium">Expiry Date Range</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">EXP From</div>
                  <Input
                    type="date"
                    value={expFrom}
                    onChange={(e) => setExpFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">EXP To</div>
                  <Input
                    type="date"
                    value={expTo}
                    onChange={(e) => setExpTo(e.target.value)}
                  />
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Note: “Include no-expiry” is currently fixed as{" "}
                <b>{includeNoExpiry ? "ON" : "OFF"}</b>.
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFiltersOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={clearAllFilters}>
              Clear all
            </Button>
            <Button onClick={applyFilters}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verified-unit delete (typed confirmation) */}
      <Dialog open={overrideDeleteOpen} onOpenChange={setOverrideDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete verified unit</DialogTitle>
            <DialogDescription>
              This unit is verified and locked. Deleting it is permanent and
              cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border p-2 text-sm">
              <div className="text-muted-foreground">Unit</div>
              <div className="font-mono">{getVisibleUnitCode(overrideTarget)}</div>
            </div>

            <div className="text-sm text-muted-foreground">
              Type <b>DELETE</b> to confirm:
            </div>
            <Input
              value={overrideConfirm}
              onChange={(e) => setOverrideConfirm(e.target.value)}
              placeholder='Type "DELETE"'
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOverrideDeleteOpen(false)}
              disabled={overrideWorking}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={runOverrideDelete}
              disabled={overrideWorking}
            >
              {overrideWorking ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Override Dialog (typed confirmation) */}
      <Dialog open={statusOverrideOpen} onOpenChange={setStatusOverrideOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm status change</DialogTitle>
            <DialogDescription>
              Changing status to <b>{statusOverrideNext ?? "-"}</b> for this
              unit. This cannot be undone automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border p-2 text-sm">
              <div className="text-muted-foreground">Unit</div>
              <div className="font-mono">{getVisibleUnitCode(statusOverrideUnit)}</div>
              <div className="text-muted-foreground mt-1">
                Current: <b>{statusOverrideUnit?.status}</b> → Next:{" "}
                <b>{statusOverrideNext}</b>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              Type <b>CONFIRM</b> to proceed:
            </div>
            <Input
              value={statusOverrideConfirm}
              onChange={(e) => setStatusOverrideConfirm(e.target.value)}
              placeholder='Type "CONFIRM"'
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStatusOverrideOpen(false);
                setStatusOverrideUnit(null);
                setStatusOverrideNext(null);
              }}
              disabled={statusOverrideWorking}
            >
              Cancel
            </Button>

            <Button
              onClick={async () => {
                if (!vendor?.id || !statusOverrideUnit || !statusOverrideNext)
                  return;

                if (statusOverrideConfirm.trim().toUpperCase() !== "CONFIRM") {
                  toast.error('Type "CONFIRM" to proceed');
                  return;
                }

                setStatusOverrideWorking(true);
                try {
                  // Vendor-scoped status flip. The server endpoint enforces
                  // owner/manager authorization (assertVendorWriter).
                  const { ok, data } = await postJson(
                    "/api/vendor/inventory-units/status",
                    {
                      ids: [statusOverrideUnit.id],
                      productId,
                      status: statusOverrideNext,
                    },
                  );

                  if (!ok) {
                    toast.error(
                      data?.error || "Status update failed",
                    );
                    return;
                  }

                  toast.success(
                    `Status updated to ${statusOverrideNext}`,
                  );

                  if (scannedUnit?.id === statusOverrideUnit.id) {
                    setScannedUnit((prev) =>
                      prev ? { ...prev, status: statusOverrideNext } : prev,
                    );
                  }

                  setStatusOverrideOpen(false);
                  setStatusOverrideUnit(null);
                  setStatusOverrideNext(null);
                  setStatusOverrideConfirm("");

                  await loadAll();
                } finally {
                  setStatusOverrideWorking(false);
                }
              }}
              disabled={statusOverrideWorking}
            >
              {statusOverrideWorking ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Export Modal */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Export</DialogTitle>
            <DialogDescription>
              Choose what you want to export (CSV).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="text-sm font-medium">Options</div>
              <div className="text-xs text-muted-foreground mt-1">
                Uses <b>inventory_units.price</b> as unit_price.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setExportOpen(false);
                  exportCurrentPage();
                }}
                disabled={!product || loading}
              >
                Export Page ({units.length})
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setExportOpen(false);
                  exportFilteredAll();
                }}
                disabled={exporting || !product}
              >
                {exporting ? "Exporting…" : `Export Filtered (${totalCount})`}
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setExportOpen(false);
                  exportSelected();
                }}
                disabled={exporting || selectedIds.size === 0 || !product}
              >
                Export Selected ({selectedIds.size})
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Transfer to product Dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Transfer units to another product</DialogTitle>
            <DialogDescription>
              Move the <b>{selectedIds.size}</b> selected unit
              {selectedIds.size === 1 ? "" : "s"} to a different product. Units
              that are <b>SOLD</b> or <b>INVOICED</b> cannot be transferred.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Search target product
              </div>
              <Input
                value={transferSearch}
                onChange={(e) => {
                  const v = e.target.value;
                  setTransferSearch(v);
                  loadTransferProducts(v);
                }}
                placeholder="Type a product name…"
              />
            </div>

            <div className="max-h-[280px] overflow-y-auto rounded-md border divide-y">
              {transferLoading ? (
                <div className="p-3 text-sm text-muted-foreground">
                  Loading…
                </div>
              ) : transferProducts.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">
                  No other products found.
                </div>
              ) : (
                transferProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTransferTargetId(p.id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted ${
                      transferTargetId === p.id ? "bg-muted font-medium" : ""
                    }`}
                  >
                    <span className="truncate">{p.name || "(no name)"}</span>
                    {transferTargetId === p.id ? (
                      <span className="text-xs text-primary">Selected</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransferOpen(false)}
              disabled={transferWorking}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmTransfer}
              disabled={
                transferWorking || !transferTargetId || selectedIds.size === 0
              }
            >
              {transferWorking
                ? "Transferring…"
                : `Transfer ${selectedIds.size} unit${selectedIds.size === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Bulk Edit Dialog */}
      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Bulk edit units</DialogTitle>
            <DialogDescription>
              Update status and/or dates in one action. Bulk setting to{" "}
              <b>SOLD</b> is disabled (needs customer details).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Scope</div>
              <Select
                value={bulkEditScope}
                onValueChange={(v) => setBulkEditScope(v as any)}
              >
                <SelectTrigger className="w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  <SelectItem value="SELECTED">
                    Selected ({selectedIds.size})
                  </SelectItem>
                  <SelectItem value="FILTERED">
                    Filtered (current filters: {totalCount})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">New status</div>
                <Select
                  value={bulkNewStatus}
                  onValueChange={(v) =>
                    setBulkNewStatus(v as InventoryStatus | "NO_CHANGE")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    <SelectItem value="NO_CHANGE">No change</SelectItem>
                    <SelectItem value="IN_STOCK">IN_STOCK</SelectItem>
                    <SelectItem value="DEMO">DEMO</SelectItem>
                    <SelectItem value="RETURNED">RETURNED</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  New manufacture date (leave empty = no change)
                </div>
                <Input
                  type="date"
                  value={bulkNewMfgDate}
                  onChange={(e) => setBulkNewMfgDate(e.target.value)}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <div className="text-xs text-muted-foreground">
                  New expiry date (leave empty = no change)
                </div>
                <Input
                  type="date"
                  value={bulkNewExpDate}
                  onChange={(e) => setBulkNewExpDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkEditOpen(false)}
              disabled={bulkEditing}
            >
              Cancel
            </Button>
            <Button onClick={runBulkEdit} disabled={bulkEditing}>
              {bulkEditing ? "Updating…" : "Apply changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Bulk Delete Dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Bulk delete units
            </DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              <b>
                {bulkDeleteScope === "SELECTED"
                  ? `${selectedIds.size} selected`
                  : `${totalCount} filtered`}
              </b>{" "}
              units. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Scope</div>

            <Select
              value={bulkDeleteScope}
              onValueChange={(v) => {
                const next = v as any;
                setBulkDeleteScope(next);
                computeBulkDeleteMeta(next);
              }}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background">
                <SelectItem value="SELECTED">
                  Selected ({selectedIds.size})
                </SelectItem>
                <SelectItem value="FILTERED">
                  Filtered (current filters: {totalCount})
                </SelectItem>
              </SelectContent>
            </Select>

            <div className="rounded-md border p-3 text-sm">
              <div>
                Target units:{" "}
                <b>
                  {bulkDeleteScope === "SELECTED"
                    ? selectedIds.size
                    : totalCount}
                </b>
              </div>

              <div className="mt-1">
                Verified in target:{" "}
                <b>{bulkDeleteMetaLoading ? "…" : bulkDeleteVerifiedCount}</b>
                {bulkDeleteVerifiedCount > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    • Choose delete mode
                  </span>
                ) : null}
              </div>
            </div>

            {bulkDeleteVerifiedCount > 0 ? (
              <div className="rounded-md border p-3 space-y-2">
                <div className="text-sm font-medium">
                  Verified units detected
                </div>

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="bulkDeleteMode"
                    checked={bulkDeleteMode === "DELETE_ALL"}
                    onChange={() => setBulkDeleteMode("DELETE_ALL")}
                  />
                  <div>
                    <div className="font-medium">
                      Delete ALL units (including verified)
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Verified units will be permanently deleted too.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="bulkDeleteMode"
                    checked={bulkDeleteMode === "SKIP_VERIFIED"}
                    onChange={() => setBulkDeleteMode("SKIP_VERIFIED")}
                  />
                  <div>
                    <div className="font-medium">
                      Delete ONLY non-verified units
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Verified units will be skipped (no admin required).
                    </div>
                  </div>
                </label>
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-sm font-medium">Your name</div>
              <Input
                value={bulkDeleteName}
                onChange={(e) => setBulkDeleteName(e.target.value)}
                placeholder="Enter your name (for audit log)"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bulkDeleteAck}
                onChange={(e) => setBulkDeleteAck(e.target.checked)}
              />
              I acknowledge this will permanently delete units and cannot be
              undone.
            </label>

            <div className="text-sm text-muted-foreground">
              Type <b>DELETE</b> to confirm
              {bulkDeleteVerifiedCount > 0 && bulkDeleteMode === "DELETE_ALL"
                ? " (verified units included)"
                : ""}
              :
            </div>
            <Input
              value={bulkDeleteConfirm}
              onChange={(e) => setBulkDeleteConfirm(e.target.value)}
              placeholder='Type "DELETE"'
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={runBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DEMO Customer Dialog */}
      <Dialog
        open={demoDialogOpen}
        onOpenChange={(v) => {
          setDemoDialogOpen(v);
          if (!v) {
            setDemoTargetUnit(null);
            resetSoldForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>Mark as DEMO</DialogTitle>
            <DialogDescription>
              Add customer details for the demo. Existing customers will appear
              as suggestions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Unit:{" "}
              <b className="font-mono">{getVisibleUnitCode(demoTargetUnit) || "-"}</b>
            </div>

            <div className="relative">
              <Input
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
                placeholder="Search customer by name / phone / email…"
                className="bg-background"
              />

              {custLoading || custSuggestions.length > 0 ? (
                <div className="absolute z-[300] mt-1 w-full rounded-md border bg-background shadow-lg">
                  {custLoading ? (
                    <div className="p-2 text-sm text-muted-foreground">
                      Searching…
                    </div>
                  ) : custSuggestions.length === 0 ? null : (
                    <div className="max-h-[220px] overflow-auto">
                      {custSuggestions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-muted"
                          onClick={() => chooseSuggestion(c)}
                        >
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.phone ?? "—"} • {c.email ?? "—"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Customer name *
                </div>
                <Input
                  value={custName}
                  onChange={(e) => {
                    setCustName(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Customer name"
                  className="bg-background"
                />
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Phone</div>
                <Input
                  value={custPhone}
                  onChange={(e) => {
                    setCustPhone(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Phone"
                  className="bg-background"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <div className="text-xs text-muted-foreground">Email</div>
                <Input
                  value={custEmail}
                  onChange={(e) => {
                    setCustEmail(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Email"
                  className="bg-background"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <div className="text-xs text-muted-foreground">Address</div>
                <Input
                  value={custAddress}
                  onChange={(e) => {
                    setCustAddress(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Address"
                  className="bg-background"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDemoDialogOpen(false);
                setDemoTargetUnit(null);
                resetSoldForm();
              }}
            >
              Cancel
            </Button>

            <Button
              onClick={saveDemoWithCustomer}
              disabled={!demoTargetUnit || updatingId === demoTargetUnit?.id}
            >
              {updatingId === demoTargetUnit?.id
                ? "Saving…"
                : "Save & Mark DEMO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer Details View Dialog */}
      <Dialog
        open={customerViewOpen}
        onOpenChange={(v) => {
          setCustomerViewOpen(v);
          if (!v) {
            setCustomerViewUnit(null);
            setCustomerViewCustomer(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Customer Details</DialogTitle>
            <DialogDescription>
              {customerViewUnit ? (
                <>
                  Unit <b className="font-mono">{getVisibleUnitCode(customerViewUnit)}</b>{" "}
                  • Status <b>{customerViewUnit.status}</b>
                </>
              ) : (
                "—"
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {customerViewLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : customerViewCustomer ? (
              <div className="rounded-md border p-3 space-y-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Name</div>
                  <div className="font-medium">{customerViewCustomer.name}</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Phone</div>
                    <div>{customerViewCustomer.phone ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Email</div>
                    <div>{customerViewCustomer.email ?? "—"}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Address</div>
                  <div className="whitespace-pre-line">
                    {customerViewCustomer.address ?? "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No customer linked for this unit.
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setCustomerViewOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SOLD Customer Dialog */}
      <Dialog
        open={soldDialogOpen}
        onOpenChange={(v) => {
          setSoldDialogOpen(v);
          if (!v) {
            setSoldTargetUnit(null);
            resetSoldForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>Mark as SOLD</DialogTitle>
            <DialogDescription>
              Add customer details for the sale. Existing customers will appear
              as suggestions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Unit:{" "}
              <b className="font-mono">{getVisibleUnitCode(soldTargetUnit) || "-"}</b>
            </div>

            <div className="relative">
              <Input
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
                placeholder="Search customer by name / phone / email…"
                className="bg-background"
              />

              {custLoading || custSuggestions.length > 0 ? (
                <div className="absolute z-[300] mt-1 w-full rounded-md border bg-background shadow-lg">
                  {custLoading ? (
                    <div className="p-2 text-sm text-muted-foreground">
                      Searching…
                    </div>
                  ) : custSuggestions.length === 0 ? null : (
                    <div className="max-h-[220px] overflow-auto">
                      {custSuggestions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-muted"
                          onClick={() => chooseSuggestion(c)}
                        >
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.phone ?? "—"} • {c.email ?? "—"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Customer name *
                </div>
                <Input
                  value={custName}
                  onChange={(e) => {
                    setCustName(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Customer name"
                  className="bg-background"
                />
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Phone</div>
                <Input
                  value={custPhone}
                  onChange={(e) => {
                    setCustPhone(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Phone"
                  className="bg-background"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <div className="text-xs text-muted-foreground">Email</div>
                <Input
                  value={custEmail}
                  onChange={(e) => {
                    setCustEmail(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Email"
                  className="bg-background"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <div className="text-xs text-muted-foreground">Address</div>
                <Input
                  value={custAddress}
                  onChange={(e) => {
                    setCustAddress(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Address"
                  className="bg-background"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSoldDialogOpen(false);
                setSoldTargetUnit(null);
                resetSoldForm();
              }}
            >
              Cancel
            </Button>

            <Button
              onClick={saveSoldWithCustomer}
              disabled={!soldTargetUnit || updatingId === soldTargetUnit?.id}
            >
              {updatingId === soldTargetUnit?.id
                ? "Saving…"
                : "Save & Mark SOLD"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
