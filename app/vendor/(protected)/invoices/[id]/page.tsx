// app/vendor/(protected)/invoices/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVendorRole } from "@/lib/hooks/useVendorRole";
import { getInventoryCodeMode, getPublicScanCode } from "@/lib/inventoryUnitCodes";
import { QRCodeSVG } from "qrcode.react";

type InvoiceCompany = {
  id: string;
  display_name: string;
  address: string | null;
  gst_number: string | null;
  email: string | null;
  // NOTE: `phone` should be selected/returned by the invoice-companies API so the
  // printed invoice can show the company's real contact number. Until then the
  // printed contact line falls back to DEFAULT_CONTACT_PHONES below.
  phone?: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  swift_code: string | null;
  upi_vpa: string | null;
};

type InvoiceRow = {
  id: string;
  company_id: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;

  customer_name: string;
  billing_address: string | null;
  phone: string | null;
  email: string | null;
  gst_number: string | null;
  pan_number: string | null;

  notes: string | null;

  subtotal?: number | null;
  discount_total?: number | null;

  tax_type?: "CGST_SGST" | "IGST" | "NONE" | null;
  cgst_percent?: number | null;
  sgst_percent?: number | null;
  igst_percent?: number | null;

  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;

  tax_amount?: number | null;
  grand_total?: number | null;
  total_amount?: number | null;

  amount_paid?: number | null;
  payment_status?: "UNPAID" | "PARTIAL" | "PAID" | null;
  paid_at?: string | null;
};

type PaymentRow = {
  id: string;
  amount: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  paid_at: string;
};

type InvoiceItemRow = {
  id: string;
  product_id: string | null;
  brand: string | null;
  description: string;
  hsn: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  position: number | null;
};


type InvoiceUnitRow = {
  id?: string;
  unit_id: string | null;
  unit_code: string | null;
  scan_code: string | null;
  product_id: string | null;
};

type DisplayUnitCodeGroup = {
  code: string;
  qty: number;
  mode: "legacy_exact" | "shared_scan";
};

const SUPPORT_EMAIL_FALLBACK = "info@madenkorea.com";
const DEFAULT_CONTACT_PHONES = "9384857587, 9384857579, 9962110101";

function fmtDate(d: string | null) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("en-IN");
  } catch {
    return d;
  }
}

function formatINR(value: number) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `₹${Number(value || 0).toFixed(2)}`;
  }
}

function fmtPct(p?: number | null) {
  const n = Number(p ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  const label = Number.isInteger(n) ? `${n}` : `${n}`;
  return ` (${label}%)`;
}

function round2(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateInclusiveTaxSplit(invoiceAmount: number, taxType: InvoiceRow["tax_type"], cgstPercent: number, sgstPercent: number, igstPercent: number) {
  const safeInvoiceAmount = round2(invoiceAmount);

  if (taxType === "CGST_SGST") {
    const totalRate = cgstPercent + sgstPercent;
    if (totalRate <= 0) {
      return { taxableAmount: safeInvoiceAmount, cgst: 0, sgst: 0, igst: 0, taxTotal: 0, grandTotal: safeInvoiceAmount };
    }

    const taxableAmount = round2((safeInvoiceAmount * 100) / (100 + totalRate));
    const cgst = round2((taxableAmount * cgstPercent) / 100);
    const sgst = round2(safeInvoiceAmount - taxableAmount - cgst);

    return {
      taxableAmount,
      cgst,
      sgst,
      igst: 0,
      taxTotal: round2(cgst + sgst),
      grandTotal: safeInvoiceAmount,
    };
  }

  if (taxType === "IGST") {
    const totalRate = igstPercent;
    if (totalRate <= 0) {
      return { taxableAmount: safeInvoiceAmount, cgst: 0, sgst: 0, igst: 0, taxTotal: 0, grandTotal: safeInvoiceAmount };
    }

    const taxableAmount = round2((safeInvoiceAmount * 100) / (100 + totalRate));
    const igst = round2(safeInvoiceAmount - taxableAmount);

    return {
      taxableAmount,
      cgst: 0,
      sgst: 0,
      igst,
      taxTotal: igst,
      grandTotal: safeInvoiceAmount,
    };
  }

  return { taxableAmount: safeInvoiceAmount, cgst: 0, sgst: 0, igst: 0, taxTotal: 0, grandTotal: safeInvoiceAmount };
}

function getLineBaseAmount(item: InvoiceItemRow) {
  return round2(Number(item.quantity || 0) * Number(item.unit_price || 0));
}

function getLineDiscountPercent(item: InvoiceItemRow) {
  const lineBase = getLineBaseAmount(item);
  if (lineBase <= 0) return 0;
  return round2((Number(item.discount || 0) / lineBase) * 100);
}

function getPerUnitAmountAfterDiscount(item: InvoiceItemRow) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || 0);
  if (quantity <= 0) return round2(unitPrice);
  return round2(unitPrice - Number(item.discount || 0) / quantity);
}

function formatPercentValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/\.00$/, "")}%`;
}

// --- Amount in words (Indian numbering: crore / lakh / thousand) ---
const WORD_ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const WORD_TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function twoDigitWords(n: number): string {
  if (n < 20) return WORD_ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return WORD_TENS[t] + (o ? " " + WORD_ONES[o] : "");
}

function threeDigitWords(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let s = "";
  if (h) s += WORD_ONES[h] + " Hundred";
  if (r) s += (s ? " " : "") + twoDigitWords(r);
  return s;
}

function numberToIndianWords(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);

  let words: string;
  if (rupees === 0) {
    words = "Zero";
  } else {
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const rest = rupees % 1000;

    const parts: string[] = [];
    if (crore) parts.push(threeDigitWords(crore) + " Crore");
    if (lakh) parts.push(twoDigitWords(lakh) + " Lakh");
    if (thousand) parts.push(twoDigitWords(thousand) + " Thousand");
    if (rest) parts.push(threeDigitWords(rest));
    words = parts.join(" ");
  }

  let result = `Rupees ${words}`;
  if (paise > 0) result += ` and ${twoDigitWords(paise)} Paise`;
  return result + " Only";
}

export default function InvoiceViewPage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = (params?.id as string) || "";
  const { isAdmin } = useVendorRole();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [company, setCompany] = useState<InvoiceCompany | null>(null);
  const [items, setItems] = useState<InvoiceItemRow[]>([]);
  const [invoiceUnits, setInvoiceUnits] = useState<InvoiceUnitRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  // Record-payment form
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [payNote, setPayNote] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [sendingEmail, setSendingEmail] = useState<null | "invoice" | "reminder">(
    null,
  );
  const [duplicating, setDuplicating] = useState(false);

  const load = useCallback(async () => {
    if (!invoiceId) return;

    setLoading(true);
    setError(null);

    try {
      const invRes = await fetch(
        `/api/vendor/invoices?id=${encodeURIComponent(invoiceId)}`,
        { cache: "no-store" },
      );
      const invJson = await invRes.json().catch(() => ({}));
      const inv = invJson?.data;
      if (!invRes.ok || !invJson?.ok || !inv)
        throw new Error(invJson?.error || "Invoice not found");
      setInvoice(inv as InvoiceRow);

      const cRes = await fetch(
        `/api/vendor/invoice-companies?id=${encodeURIComponent((inv as any).company_id)}`,
        { cache: "no-store" },
      );
      const cJson = await cRes.json().catch(() => ({}));
      if (!cRes.ok || !cJson?.ok) console.error(cJson?.error);
      setCompany((cJson?.data || null) as InvoiceCompany | null);

      const itsRes = await fetch(
        `/api/vendor/invoice-items?invoice_id=${encodeURIComponent(invoiceId)}`,
        { cache: "no-store" },
      );
      const itsJson = await itsRes.json().catch(() => ({}));
      if (!itsRes.ok || !itsJson?.ok)
        throw new Error(itsJson?.error || "Failed to load items");
      setItems((itsJson.data || []) as InvoiceItemRow[]);

      const iusRes = await fetch(
        `/api/vendor/invoice-units?invoice_id=${encodeURIComponent(invoiceId)}`,
        { cache: "no-store" },
      );
      const iusJson = await iusRes.json().catch(() => ({}));
      if (!iusRes.ok || !iusJson?.ok) {
        console.error("Failed to load invoice units", iusJson?.error);
        setInvoiceUnits([]);
      } else {
        setInvoiceUnits((iusJson.data || []) as InvoiceUnitRow[]);
      }

      const paysRes = await fetch(
        `/api/vendor/invoice-payments?invoice_id=${encodeURIComponent(invoiceId)}`,
        { cache: "no-store" },
      );
      const paysJson = await paysRes.json().catch(() => ({}));
      setPayments((paysJson?.data || []) as PaymentRow[]);
    } catch (e: any) {
      setError(e.message || "Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  const sellerName = company?.display_name || "—";
  const sellerEmail = company?.email || SUPPORT_EMAIL_FALLBACK;
  const sellerAddress = company?.address || "—";
  const sellerGstin = company?.gst_number || "—";
  // Prefer the company's own phone when the API provides it; otherwise fall back
  // to the historical hardcoded contact numbers so the printed invoice never blanks.
  const sellerPhones = (company?.phone || "").trim() || DEFAULT_CONTACT_PHONES;

  const invoiceNumber = invoice?.invoice_number || "—";
  const invoiceDateLabel = fmtDate(invoice?.invoice_date || null);

  const customerName = invoice?.customer_name || "—";
  const billingAddress = invoice?.billing_address || "—";
  const phone = invoice?.phone || "—";
  const customerGstin = invoice?.gst_number || "";
  const panNumber = invoice?.pan_number || "";
  const notes = invoice?.notes || "";

  const unitCodeGroupsByProduct = useMemo(() => {
    const grouped = new Map<string, DisplayUnitCodeGroup[]>();

    for (const row of invoiceUnits) {
      const productId = row.product_id || "";
      if (!productId) continue;

      const mode = getInventoryCodeMode(row);
      const visibleCode = mode === "shared_scan"
        ? getPublicScanCode(row)
        : (row.unit_code || getPublicScanCode(row));

      if (!visibleCode) continue;

      const current = grouped.get(productId) || [];
      const existing = current.find((entry) => entry.code === visibleCode && entry.mode === mode);
      if (existing) {
        existing.qty += 1;
      } else {
        current.push({ code: visibleCode, qty: 1, mode });
      }
      grouped.set(productId, current);
    }

    return grouped;
  }, [invoiceUnits]);

  const computed = useMemo(() => {
    const subtotalFromItems = round2(
      items.reduce((sum, item) => sum + getLineBaseAmount(item), 0),
    );
    const discountFromItems = round2(
      items.reduce((sum, item) => sum + Number(item.discount || 0), 0),
    );

    const subtotal =
      items.length > 0
        ? subtotalFromItems
        : round2(Number(invoice?.subtotal ?? 0));

    const discountTotal =
      items.length > 0
        ? discountFromItems
        : round2(Number(invoice?.discount_total ?? 0));

    const invoiceAmount = round2(Math.max(subtotal - discountTotal, 0));

    const taxType = (invoice?.tax_type || "CGST_SGST") as
      | "CGST_SGST"
      | "IGST"
      | "NONE";

    const cgstPercent = Number(invoice?.cgst_percent ?? 0);
    const sgstPercent = Number(invoice?.sgst_percent ?? 0);
    const igstPercent = Number(invoice?.igst_percent ?? 0);

    const taxSplit = calculateInclusiveTaxSplit(
      invoiceAmount,
      taxType,
      cgstPercent,
      sgstPercent,
      igstPercent,
    );

    return {
      subtotal,
      discountTotal,
      taxableAmount: taxSplit.taxableAmount,
      taxType,
      cgstPercent,
      sgstPercent,
      igstPercent,
      cgst: taxSplit.cgst,
      sgst: taxSplit.sgst,
      igst: taxSplit.igst,
      taxTotal: taxSplit.taxTotal,
      grandTotal: taxSplit.grandTotal,
    };
  }, [items, invoice]);

  // --- Payment derived values + actions ---
  const grandTotalValue = Number(
    invoice?.grand_total ?? invoice?.total_amount ?? computed.grandTotal,
  );
  const amountPaid = Number(invoice?.amount_paid ?? 0);
  const outstanding = round2(Math.max(grandTotalValue - amountPaid, 0));
  const paymentStatus = invoice?.payment_status ?? "UNPAID";

  // UPI payment QR: show only when the seller company has a VPA configured and
  // there is still a balance due. The QR encodes a standard UPI deep link that
  // any UPI app can scan to pre-fill payee, amount and a note (invoice number).
  const upiVpa = (company?.upi_vpa || "").trim();
  const showUpiQr = upiVpa.length > 0 && outstanding > 0;
  const upiLink = showUpiQr
    ? `upi://pay?pa=${upiVpa}&pn=${encodeURIComponent(
        company?.display_name || "",
      )}&am=${outstanding.toFixed(2)}&cu=INR&tn=${encodeURIComponent(
        invoice?.invoice_number || "",
      )}`
    : "";

  const recordPayment = async (
    amountOverride?: number,
    methodOverride?: string,
  ) => {
    const amt = round2(Number(amountOverride ?? payAmount));
    if (!amt || amt <= 0) {
      toast.error("Enter a valid payment amount.");
      return;
    }
    setSavingPayment(true);
    let payErr: { message?: string } | null = null;
    try {
      const res = await fetch("/api/vendor/invoices/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: invoiceId,
          amount: amt,
          method: methodOverride ?? (payMethod || null),
          reference: payRef || null,
          note: payNote || null,
          paid_at: payDate || new Date().toISOString().slice(0, 10),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        payErr = { message: json?.error || "Failed to record payment" };
      }
    } catch (e: any) {
      payErr = { message: e?.message || "Failed to record payment" };
    }
    setSavingPayment(false);
    if (payErr) {
      toast.error(payErr.message || "Failed to record payment");
      return;
    }
    toast.success("Payment recorded.");
    setShowPayForm(false);
    setPayAmount("");
    setPayRef("");
    setPayNote("");
    await load();
  };

  const deletePayment = async (id: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this payment? This cannot be undone.")
    ) {
      return;
    }
    let delErr: { message?: string } | null = null;
    try {
      const res = await fetch(
        `/api/vendor/invoices/payments?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        delErr = { message: json?.error || "Failed to remove payment" };
      }
    } catch (e: any) {
      delErr = { message: e?.message || "Failed to remove payment" };
    }
    if (delErr) {
      toast.error(delErr.message || "Failed to remove payment");
      return;
    }
    toast.success("Payment removed.");
    await load();
  };

  const markFullyPaid = async () => {
    if (outstanding <= 0) {
      toast.info("This invoice is already fully paid.");
      return;
    }
    await recordPayment(outstanding, "Manual");
  };


  const sendInvoiceEmail = async (type: "invoice" | "reminder") => {
    if (!invoice?.email) {
      toast.error("This invoice has no customer email address.");
      return;
    }
    setSendingEmail(type);
    try {
      // Cookie-authenticated (NextAuth) — the email endpoint resolves the vendor
      // from the session via getRouteVendor, so no bearer token is needed.
      const res = await fetch(`/api/invoices/${invoiceId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || "Failed to send email");
        return;
      }
      toast.success(
        type === "reminder"
          ? "Payment reminder emailed to the customer."
          : "Invoice emailed to the customer.",
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to send email");
    } finally {
      setSendingEmail(null);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-10 text-sm text-muted-foreground">
        Loading invoice…
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="container mx-auto py-10">
        <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || "Invoice not found"}
        </div>
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => router.push("/vendor/invoices")}
          >
            ← Back to Invoices
          </Button>
        </div>
      </div>
    );
  }

  // Split line items into real products (have a product_id) vs. non-product
  // "additional charges" (freight, packing, stands, etc. — saved with
  // product_id = null via the "Add charge" flow). Charges render in their own
  // block near the totals instead of polluting the goods table. Only split when
  // the invoice actually has BOTH kinds; a fully-custom/manual invoice (no
  // product lines) keeps every row in the table unchanged. Totals are computed
  // over all items either way, so the grand total never changes.
  const productItems = items.filter((it) => it.product_id);
  const chargeItems = items.filter((it) => !it.product_id);
  const splitCharges = productItems.length > 0 && chargeItems.length > 0;
  const tableItems = splitCharges ? productItems : items;
  const chargeRows = splitCharges ? chargeItems : [];

  const SummaryStrip = () => (
    <div className="border border-slate-300 rounded-md bg-muted/20 p-3 text-sm">
      <div className="grid grid-cols-2 gap-y-1">
        <div className="text-muted-foreground">Subtotal</div>
        <div className="text-right font-medium">
          {formatINR(computed.subtotal)}
        </div>

        <div className="text-muted-foreground">Total Discount</div>
        <div className="text-right font-medium">
          {formatINR(computed.discountTotal)}
        </div>

        <div className="text-muted-foreground border-t mt-1 pt-2">
          Taxable Amount
        </div>
        <div className="text-right font-medium border-t mt-1 pt-2">
          {formatINR(computed.taxableAmount)}
        </div>

        {computed.taxType === "CGST_SGST" ? (
          <>
            <div className="text-muted-foreground">
              CGST{fmtPct(computed.cgstPercent)}
            </div>
            <div className="text-right">{formatINR(computed.cgst)}</div>

            <div className="text-muted-foreground">
              SGST{fmtPct(computed.sgstPercent)}
            </div>
            <div className="text-right">{formatINR(computed.sgst)}</div>
          </>
        ) : null}

        {computed.taxType === "IGST" ? (
          <>
            <div className="text-muted-foreground">
              IGST{fmtPct(computed.igstPercent)}
            </div>
            <div className="text-right">{formatINR(computed.igst)}</div>
          </>
        ) : null}

        <div className="col-span-2 border-t mt-2 pt-2 flex justify-between font-semibold text-base">
          <span>Invoice Amount</span>
          <span>{formatINR(computed.grandTotal)}</span>
        </div>

        {amountPaid > 0 && (
          <>
            <div className="col-span-2 flex justify-between pt-1">
              <span className="text-muted-foreground">Paid</span>
              <span>{formatINR(amountPaid)}</span>
            </div>
            <div className="col-span-2 flex justify-between font-semibold">
              <span>Balance Due</span>
              <span>{formatINR(outstanding)}</span>
            </div>
          </>
        )}

      </div>
    </div>
  );

  const NotesAndSignature = () => (
    <>
    
<div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3 print:grid-cols-3">
  {/* Notes: 2/3 */}
  <div className="md:col-span-2 print:col-span-2">
    <div className="text-xs font-semibold mb-1">Notes</div>
    <div className="min-h-[90px] rounded-md border border-slate-300 p-3 text-xs whitespace-pre-line">
      {notes || "—"}
    </div>
  </div>

  {/* Seal/Signature: 1/3 */}
  <div className="md:col-span-1 print:col-span-1">
    <div className="text-xs font-semibold mb-1">Authorized Signatory</div>
    <div className="min-h-[90px] rounded-md border border-slate-300 p-3 text-xs flex flex-col justify-between">
      <div className="text-[11px] text-slate-600">For {sellerName}</div>

      {/* Optional seal image placeholder */}
      {/* <div className="h-10 border border-dashed border-slate-300 rounded mt-2" /> */}

      <div className="pt-6 text-right">
        <div className="text-[11px] text-slate-600">Seal / Signature</div>
      </div>
    </div>
  </div>
</div>
</>
  );

  return (
    <div className="min-h-screen bg-white">
      <style jsx global>{`
        @media print {
          .print-hidden {
            display: none !important;
          }
          .print-wrap {
            max-width: none !important;
            padding: 0 !important;
          }
          .print-order-1 {
            order: 1;
          }
          .print-order-2 {
            order: 2;
          }
          .print-order-3 {
            order: 3;
          }
        }
      `}</style>

      {/* Controls (hidden in print) */}
      <div className="print-hidden container mx-auto max-w-5xl py-4 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1)
              router.back();
            else router.push("/vendor/invoices");
          }}
        >
          ← Back
        </Button>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => router.push(`/vendor/invoices/${invoiceId}/edit`)}
            >
              Edit
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            Print / Save PDF
          </Button>
        </div>
      </div>

      {/* Payments (internal — hidden in print) */}
      <div className="print-hidden container mx-auto max-w-5xl pb-2">
        <div className="rounded-lg border bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">Payment</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  paymentStatus === "PAID"
                    ? "bg-green-100 text-green-700"
                    : paymentStatus === "PARTIAL"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {paymentStatus}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={outstanding <= 0}
                    onClick={() => {
                      setPayAmount(String(outstanding));
                      setShowPayForm((s) => !s);
                    }}
                  >
                    Record Payment
                  </Button>
                  <Button
                    size="sm"
                    disabled={outstanding <= 0 || savingPayment}
                    onClick={markFullyPaid}
                  >
                    Mark Fully Paid
                  </Button>
                </>
              )}
              {/* Email actions available to all team members */}
              <Button
                size="sm"
                variant="outline"
                disabled={!invoice?.email || sendingEmail !== null}
                title={
                  invoice?.email
                    ? `Email invoice to ${invoice.email}`
                    : "No customer email on this invoice"
                }
                onClick={() => sendInvoiceEmail("invoice")}
              >
                {sendingEmail === "invoice" ? "Sending…" : "Email Invoice"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !invoice?.email || outstanding <= 0 || sendingEmail !== null
                }
                title={
                  !invoice?.email
                    ? "No customer email on this invoice"
                    : outstanding <= 0
                      ? "Nothing outstanding"
                      : `Send a payment reminder to ${invoice.email}`
                }
                onClick={() => sendInvoiceEmail("reminder")}
              >
                {sendingEmail === "reminder" ? "Sending…" : "Send Reminder"}
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Invoice Total</div>
              <div className="font-medium">{formatINR(grandTotalValue)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Paid</div>
              <div className="font-medium text-green-700">
                {formatINR(amountPaid)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Outstanding</div>
              <div className="font-medium text-red-700">
                {formatINR(outstanding)}
              </div>
            </div>
          </div>

          {isAdmin && showPayForm && (
            <div className="mt-3 grid gap-2 rounded-md border bg-white p-3 sm:grid-cols-5">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Amount</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Method</label>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                >
                  <option>Cash</option>
                  <option>Bank Transfer</option>
                  <option>UPI</option>
                  <option>Cheque</option>
                  <option>Card</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Date</label>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Reference
                </label>
                <Input
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Txn / Cheque no."
                />
              </div>
              <div className="flex items-end">
                <Button
                  size="sm"
                  className="w-full"
                  disabled={savingPayment}
                  onClick={() => recordPayment()}
                >
                  {savingPayment ? "Saving..." : "Save Payment"}
                </Button>
              </div>
            </div>
          )}

          {payments.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border bg-white">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Method</th>
                    <th className="px-3 py-2 text-left">Reference</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="px-3 py-2">{fmtDate(p.paid_at)}</td>
                      <td className="px-3 py-2">{p.method || "-"}</td>
                      <td className="px-3 py-2">{p.reference || "-"}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatINR(Number(p.amount))}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isAdmin ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            onClick={() => deletePayment(p.id)}
                          >
                            Remove
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Printable */}
      <div className="print-wrap mx-auto max-w-5xl px-4 pb-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 border-b pb-3">
          {/* Seller (order: Address -> GST -> Email) */}
          <div className="min-w-0">
            <div className="text-xl font-bold">{sellerName}</div>

            {/* 1) Address */}
            <div className="text-xs whitespace-pre-line mt-1">
              {sellerAddress}
            </div>

            {/* 2) GST */}
            <div className="text-xs text-muted-foreground mt-1">
              GSTIN: <span className="text-foreground">{sellerGstin}</span>
            </div>

            {/* 3) Email */}
            <div className="text-xs text-muted-foreground mt-1">
              Support: <span className="text-foreground">{sellerEmail}</span>
            </div>

            {/* 4) Contact numbers */}
            <div className="text-xs text-muted-foreground mt-1">
              Contact: <span className="text-foreground">{sellerPhones}</span>
            </div>
          </div>

          {/* Right meta */}
          <div className="text-right">
            <div className="text-2xl font-bold tracking-wide">INVOICE</div>
            <div className="mt-1 text-sm space-y-1">
              <div className="flex justify-end gap-2 whitespace-nowrap">
                <span className="text-muted-foreground">Invoice No</span>
                <span className="font-medium">{invoiceNumber}</span>
              </div>
              <div className="flex justify-end gap-2 whitespace-nowrap">
                <span className="text-muted-foreground">Invoice Date</span>
                <span className="font-medium">{invoiceDateLabel}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bill to */}
        <div className="mt-3 text-sm">
          <div className="font-semibold mb-1">Bill To</div>
          <div className="font-medium">{customerName}</div>
          <div className="text-xs whitespace-pre-line">{billingAddress}</div>

          <div className="text-xs mt-2 space-y-1">
            <div>Phone: {phone}</div>
            {customerGstin ? <div>GSTIN: {customerGstin}</div> : null}
            {panNumber ? <div>PAN: {panNumber}</div> : null}
          </div>
        </div>

        {/* Body */}
        <div className="mt-4 flex flex-col gap-4">
          {/* Items */}
          <div className="print-order-1 order-1 border border-slate-300 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-2 text-left w-[50px]">Sl.No</th>
                  <th className="px-2 py-2 text-left w-[110px]">Brand</th>
                  <th className="px-2 py-2 text-left w-auto">Description</th>
                  <th className="px-2 py-2 text-left w-[80px]">HSN</th>
                  <th className="px-2 py-2 text-right w-[60px]">Qty</th>
                  <th className="px-2 py-2 text-right w-[90px]">Rate</th>
                  <th className="px-2 py-2 text-right w-[90px]">Discount</th>
                  <th className="px-2 py-2 text-right w-[120px]">Per Unit Discount Amt</th>
                  <th className="px-2 py-2 text-right w-[100px]">Amount</th>
                </tr>
              </thead>

              <tbody>
                {tableItems.map((it, idx) => {
                  const lineBaseAmount = getLineBaseAmount(it);
                  const totalDiscountApplied = round2(Number(it.discount || 0));
                  const lineDiscountPercent = getLineDiscountPercent(it);
                  const perUnitAfterDiscount = getPerUnitAmountAfterDiscount(it);
                  const amt = round2(lineBaseAmount - totalDiscountApplied);

                  return (
                    <tr key={it.id} className="border-t">
                      <td className="px-2 py-2">{idx + 1}</td>
                      <td className="px-2 py-2">{it.brand || "-"}</td>

                      <td className="px-2 py-2 align-top">
                       <div className="break-words font-medium text-[10.5px] leading-[1.15]">
                          {it.description}
                        </div>
                      
                      </td>

                      <td className="px-2 py-2">{it.hsn || "-"}</td>
                      <td className="px-2 py-2 text-right">{it.quantity}</td>
                      <td className="px-2 py-2 text-right">
                        {formatINR(Number(it.unit_price || 0))}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatPercentValue(lineDiscountPercent)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatINR(perUnitAfterDiscount)}
                      </td>
                      <td className="px-2 py-2 text-right font-medium">
                        {formatINR(amt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Additional charges (non-product lines) — kept out of the goods
              table and shown as their own block. Their amounts are already
              included in the totals below. */}
          {chargeRows.length > 0 && (
            <div className="print-order-1 order-1 border border-slate-300 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-2 py-2 text-left">Additional Charges</th>
                    <th className="px-2 py-2 text-right w-[120px]">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {chargeRows.map((c) => {
                    const amt = round2(
                      getLineBaseAmount(c) - round2(Number(c.discount || 0)),
                    );
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="px-2 py-2">
                          <div className="break-words font-medium text-[10.5px] leading-[1.15]">
                            {c.description}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right font-medium">
                          {formatINR(amt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals strip */}
          <div className="print-order-2 order-2 flex justify-end">
            <div className="w-[360px]">
              <SummaryStrip />
            </div>
          </div>

          {/* Amount in words */}
          <div className="print-order-2 order-2 text-sm">
            <span className="text-muted-foreground">Amount in words: </span>
            <span className="font-medium">
              {numberToIndianWords(computed.grandTotal)}
            </span>
          </div>

          {/* Bank details */}
          {company && (company.bank_name || company.account_number) && (
            <div className="print-order-2 order-2 rounded-md border border-slate-300 p-3 text-xs">
              <div className="font-semibold mb-1">Bank Details</div>
              <div className="grid grid-cols-1 gap-y-0.5 sm:grid-cols-2">
                {company.bank_name && (
                  <div>
                    <span className="text-muted-foreground">Bank: </span>
                    {company.bank_name}
                  </div>
                )}
                {company.bank_branch && (
                  <div>
                    <span className="text-muted-foreground">Branch: </span>
                    {company.bank_branch}
                  </div>
                )}
                {company.account_number && (
                  <div>
                    <span className="text-muted-foreground">A/C No: </span>
                    {company.account_number}
                  </div>
                )}
                {company.ifsc_code && (
                  <div>
                    <span className="text-muted-foreground">IFSC: </span>
                    {company.ifsc_code}
                  </div>
                )}
                {company.swift_code && (
                  <div>
                    <span className="text-muted-foreground">SWIFT: </span>
                    {company.swift_code}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* UPI payment QR */}
          {showUpiQr ? (
            <div className="print-order-2 order-2 rounded-md border border-slate-300 p-3">
              <div className="text-xs font-semibold mb-2">Pay via UPI</div>
              <div className="flex items-center gap-4">
                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <QRCodeSVG value={upiLink} size={160} level="M" includeMargin />
                </div>
                <div className="text-xs space-y-1">
                  <div>
                    <span className="text-muted-foreground">UPI ID: </span>
                    <span className="font-medium">{upiVpa}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Amount: </span>
                    <span className="font-medium">{formatINR(outstanding)}</span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Scan with any UPI app (GPay / PhonePe / Paytm)
                  </div>
                </div>
              </div>
            </div>
          ) : !upiVpa && isAdmin ? (
            <div className="print-hidden text-xs text-muted-foreground">
              Add a UPI ID to this company to show a payment QR —{" "}
              <a
                href="/vendor/invoice-companies"
                className="underline hover:text-foreground"
              >
                Manage companies
              </a>
            </div>
          ) : null}

          {/* Notes + Signature */}
         {/* Row 2: Notes + Authorized Seal/Signature (2 columns in one row) */}


        </div>
{/* Row 2: Notes + Authorized Seal/Signature (equal height) */}
<div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3 print:grid-cols-3 items-stretch">
  {/* Notes: 2/3 */}
  <div className="md:col-span-2 print:col-span-2 flex flex-col">
    <div className="text-xs font-semibold mb-1">Notes</div>

    {/* ✅ h-full + flex-1 makes it match right side height */}
    <div className="flex-1 min-h-[120px] rounded-md border border-slate-300 p-3 text-xs whitespace-pre-line">
      {notes || "—"}
    </div>
  </div>

  {/* Signatory: 1/3 */}
  <div className="md:col-span-1 print:col-span-1 flex flex-col">
    <div className="text-xs font-semibold mb-1">Authorized Signatory</div>

    {/* ✅ same min-h + flex-1 */}
    <div className="flex-1 min-h-[120px] rounded-md border border-slate-300 p-3 text-xs flex flex-col justify-between">
      <div className="text-[11px] text-slate-600">For {sellerName}</div>

      <div className="pt-6 text-right">
        <div className="text-[11px] text-slate-600">Seal / Signature</div>
      </div>
    </div>
  </div>
</div>

      </div>
    </div>
  );
}
