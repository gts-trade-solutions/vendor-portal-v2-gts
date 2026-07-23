// app/vendor/(protected)/invoices/[id]/edit/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useVendorRole } from "@/lib/hooks/useVendorRole";
import {
  getPublicScanCode,
  hasLegacySequenceSuffix,
  sortUnitsForAllocation,
  type InventoryCodeMode,
} from "@/lib/inventoryUnitCodes";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { numberToIndianWords } from "@/lib/invoice-calculations";
import {
  QuickAddAddressDialog,
  type InvoiceAddress,
} from "@/components/addresses/QuickAddAddressDialog";
import { AddressSearchSelect } from "@/components/addresses/AddressSearchSelect";

const SUPPORT_EMAIL_FALLBACK = "info@madenkorea.com";

type TaxType = "CGST_SGST" | "IGST" | "NONE";

type InvoiceCompany = {
  id: string;
  display_name: string;
  address: string | null;
  gst_number: string | null;
  email: string | null;
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

  tax_type?: TaxType | null;
  cgst_percent?: number | null;
  sgst_percent?: number | null;
  igst_percent?: number | null;

  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;

  tax_amount?: number | null;
  grand_total?: number | null;
  total_amount?: number | null;

  is_custom?: boolean | null;
  bill_to_address_id?: string | null;
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
  discount_percent?: number;
  position: number | null;
};

type ProductSuggestion = {
  id: string;
  name: string;
  hsn: string | null;
  mrp: number | null;
  brandName: string | null;
};

type ScannedUnit = {
  unit_id: string;
  unit_code: string;
  scan_code: string;
  display_code: string;
  allocation_mode: InventoryCodeMode;
  product_id: string;
  product_name: string;
  brand_name: string;
  hsn: string;
  base_rate: number;
};

type LineOverride = { rate?: number; discountPercent?: number; hsn?: string };

type InvoiceLine = {
  product_id: string;
  description: string;
  brand: string;
  hsn: string;
  rate: number;
  qty: number;
  discountPercent: number;
  discountAmount: number;
  amount: number;
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtINR = (v: any) =>
  inr.format(Number.isFinite(Number(v)) ? Number(v) : 0);

const round2 = (value: number) => Number(value.toFixed(2));

function discountPercentFromStored(totalDiscount: number, unitPrice: number, quantity: number) {
  const base = Number(unitPrice || 0) * Number(quantity || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return round2((Number(totalDiscount || 0) / base) * 100);
}

function totalLineDiscountFromPercent(unitPrice: number, quantity: number, discountPercent: number) {
  const safeRate = Number(unitPrice || 0);
  const safeQty = Number(quantity || 0);
  const safePercent = Math.max(0, Number(discountPercent || 0));
  return round2((safeQty * safeRate * safePercent) / 100);
}

function perUnitAfterDiscountFromPercent(unitPrice: number, discountPercent: number) {
  const safeRate = Number(unitPrice || 0);
  const safePercent = Math.max(0, Number(discountPercent || 0));
  return round2(safeRate - (safeRate * safePercent) / 100);
}

function extractInclusiveTaxAmounts(
  amountAfterDiscount: number,
  taxType: TaxType,
  cgstPercent: number,
  sgstPercent: number,
  igstPercent: number,
  inclusive: boolean = true,
) {
  const gross = round2(Number(amountAfterDiscount || 0));

  // EXCLUSIVE: `gross` is the pre-tax base; tax is added ON TOP of the total.
  if (!inclusive) {
    const cgstAmount =
      taxType === "CGST_SGST" ? round2((gross * Number(cgstPercent || 0)) / 100) : 0;
    const sgstAmount =
      taxType === "CGST_SGST" ? round2((gross * Number(sgstPercent || 0)) / 100) : 0;
    const igstAmount =
      taxType === "IGST" ? round2((gross * Number(igstPercent || 0)) / 100) : 0;
    const taxTotal = round2(cgstAmount + sgstAmount + igstAmount);
    return {
      taxableAmount: gross,
      cgstAmount,
      sgstAmount,
      igstAmount,
      taxTotal,
      grandTotal: round2(gross + taxTotal),
    };
  }

  if (taxType === "CGST_SGST") {
    const totalPercent = Number(cgstPercent || 0) + Number(sgstPercent || 0);
    if (totalPercent <= 0) {
      return {
        taxableAmount: gross,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        taxTotal: 0,
        grandTotal: gross,
      };
    }

    const taxableAmount = round2(gross / (1 + totalPercent / 100));
    const cgstAmount = round2((taxableAmount * Number(cgstPercent || 0)) / 100);
    const sgstAmount = round2((taxableAmount * Number(sgstPercent || 0)) / 100);
    const taxTotal = round2(cgstAmount + sgstAmount);

    return {
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount: 0,
      taxTotal,
      grandTotal: gross,
    };
  }

  if (taxType === "IGST") {
    const totalPercent = Number(igstPercent || 0);
    if (totalPercent <= 0) {
      return {
        taxableAmount: gross,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        taxTotal: 0,
        grandTotal: gross,
      };
    }

    const taxableAmount = round2(gross / (1 + totalPercent / 100));
    const igstAmount = round2((taxableAmount * totalPercent) / 100);
    const taxTotal = round2(igstAmount);

    return {
      taxableAmount,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount,
      taxTotal,
      grandTotal: gross,
    };
  }

  return {
    taxableAmount: gross,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    taxTotal: 0,
    grandTotal: gross,
  };
}

function toDateInputValue(d: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function createEmptyItem(): InvoiceItemRow {
  return {
    id: crypto.randomUUID(),
    product_id: null,
    brand: "",
    description: "",
    hsn: "",
    quantity: 1,
    unit_price: 0,
    discount: 0,
    discount_percent: 0,
    position: null,
  };
}

export default function InvoiceEditPage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = (params?.id as string) || "";
  const { isAdmin, isViewer } = useVendorRole();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [company, setCompany] = useState<InvoiceCompany | null>(null);
  const [companies, setCompanies] = useState<InvoiceCompany[]>([]);
  const [companyId, setCompanyId] = useState<string>("");

  // manual items (custom invoices)
  const [items, setItems] = useState<InvoiceItemRow[]>([createEmptyItem()]);

  // Header fields
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState<string>("");

  const [customerName, setCustomerName] = useState<string>("");
  const [billingAddress, setBillingAddress] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [gstNumber, setGstNumber] = useState<string>("");
  const [panNumber, setPanNumber] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Saved bill-to addresses + selection (same dropdown as the create page).
  const [addresses, setAddresses] = useState<InvoiceAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/vendor/invoice-addresses", {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        setAddresses(
          res.ok && json?.ok ? ((json.data || []) as InvoiceAddress[]) : [],
        );
      } catch {
        setAddresses([]);
      }
    })();
  }, []);
  // Selecting a saved address prefills the customer + billing fields.
  const applyAddressToCustomerFields = (addr: InvoiceAddress) => {
    setCustomerName(addr.name || "");
    setPhone(addr.phone || "");
    setEmail(addr.email || "");
    setGstNumber(addr.gstin || "");
    setBillingAddress(
      [
        addr.address_line1,
        addr.address_line2,
        `${addr.city}, ${addr.state} - ${addr.pincode}`,
        addr.country || "India",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  };

  // Tax controls
  const [taxType, setTaxType] = useState<TaxType>("CGST_SGST");
  // true = tax INCLUDED within the grand total; false = ADDED on top.
  const [taxInclusive, setTaxInclusive] = useState<boolean>(true);
  const [cgstPercent, setCgstPercent] = useState<number>(9);
  const [sgstPercent, setSgstPercent] = useState<number>(9);
  const [igstPercent, setIgstPercent] = useState<number>(18);

  // mode - DO NOT let user flip for safety; keep based on stored invoice flag
  const [isCustom, setIsCustom] = useState<boolean>(true);

  // manual suggestion UX (only used for manual web-generated invoices; but your flow is now scan-based)
  const [productSuggestionsByItem, setProductSuggestionsByItem] = useState<
    Record<string, ProductSuggestion[]>
  >({});
  const [activeSuggestForItemId, setActiveSuggestForItemId] = useState<
    string | null
  >(null);

  // scan-mode states
  const [scanCode, setScanCode] = useState("");
  const [scanQty, setScanQty] = useState<number>(1);
  const [scanAvailability, setScanAvailability] = useState<string>("");
  const [scannedUnits, setScannedUnits] = useState<ScannedUnit[]>([]);
  const [lineOverrides, setLineOverrides] = useState<
    Record<string, LineOverride>
  >({});

  // refs to compute diff on save (revert removed units, sold added units)
  const originalUnitIdsRef = useRef<string[]>([]);

  const selectedCompany = useMemo(
    () => companies.find((entry) => entry.id === companyId) ?? company,
    [companies, companyId, company],
  );

  const sellerName = selectedCompany?.display_name || "—";
  const sellerEmail = selectedCompany?.email || SUPPORT_EMAIL_FALLBACK;
  const sellerGstin = selectedCompany?.gst_number || "—";

  const setLineRate = (productId: string, rate: number) => {
    setLineOverrides((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), rate },
    }));
  };

  const setLineDiscountPercent = (productId: string, discountPercent: number) => {
    setLineOverrides((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), discountPercent },
    }));
  };

  const setLineHsn = (productId: string, hsn: string) => {
    setLineOverrides((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), hsn },
    }));
  };

  // Free-typing buffer for the editable "net price per unit" field so the
  // derived value doesn't fight every keystroke; commits the % on blur.
  const [netDraft, setNetDraft] = useState<Record<string, string>>({});
  const commitNet = (
    key: string,
    base: number,
    apply: (pct: number) => void,
  ) => {
    const raw = netDraft[key];
    setNetDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (raw === undefined || raw === "") return;
    const net = Number(raw);
    const pct =
      base > 0 && Number.isFinite(net)
        ? Math.min(100, Math.max(0, round2((1 - net / base) * 100)))
        : 0;
    apply(pct);
  };

  // Additional manual charges (freight, packing, etc.) — non-product line items.
  const [extraCharges, setExtraCharges] = useState<
    { id: string; description: string; amount: number }[]
  >([]);
  const addExtraCharge = () =>
    setExtraCharges((prev) => [
      ...prev,
      { id: crypto.randomUUID(), description: "", amount: 0 },
    ]);
  const updateExtraCharge = (
    id: string,
    patch: Partial<{ description: string; amount: number }>,
  ) =>
    setExtraCharges((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  const removeExtraCharge = (id: string) =>
    setExtraCharges((prev) => prev.filter((c) => c.id !== id));

  // Load invoice + company + (items OR units)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!invoiceId) return;

      setLoading(true);
      setError(null);
      setLoadWarning(null);

      try {
        const invRes = await fetch(
          `/api/vendor/invoices?id=${encodeURIComponent(invoiceId)}`,
          { cache: "no-store" },
        );
        const invJson = await invRes.json().catch(() => ({}));
        const inv = invJson?.data;
        if (!invRes.ok || !invJson?.ok || !inv)
          throw new Error(invJson?.error || "Invoice not found");
        if (cancelled) return;

        setInvoice(inv as InvoiceRow);
        setCompanyId((inv as any).company_id ?? "");
        setInvoiceNumber((inv as any).invoice_number ?? "");

        setInvoiceDate(toDateInputValue(inv.invoice_date ?? null));
        setDueDate(toDateInputValue(inv.due_date ?? null));

        setCustomerName(inv.customer_name ?? "");
        setBillingAddress(inv.billing_address ?? "");
        setPhone(inv.phone ?? "");
        setEmail(inv.email ?? "");
        setGstNumber(inv.gst_number ?? "");
        setPanNumber(inv.pan_number ?? "");
        setNotes(inv.notes ?? "");
        setSelectedAddressId((inv as any).bill_to_address_id ?? "");

        const tt = ((inv as any).tax_type ?? "CGST_SGST") as TaxType;
        setTaxType(tt);
        setTaxInclusive((inv as any).tax_inclusive ?? true);
        setCgstPercent(Number((inv as any).cgst_percent ?? 9));
        setSgstPercent(Number((inv as any).sgst_percent ?? 9));
        setIgstPercent(Number((inv as any).igst_percent ?? 18));

        const customFlag = Boolean((inv as any).is_custom ?? true);
        setIsCustom(customFlag);

        // Company options
        const companyRes = await fetch("/api/vendor/invoice-companies", {
          cache: "no-store",
        });
        const companyJson = await companyRes.json().catch(() => ({}));
        if (!companyRes.ok || !companyJson?.ok)
          throw new Error(companyJson?.error || "Failed to load invoice companies");

        if (!cancelled) {
          const rows = (companyJson.data || []) as InvoiceCompany[];
          setCompanies(rows);
          setCompany(rows.find((entry) => entry.id === (inv as any).company_id) ?? null);
        }

        // Always load invoice_items (needed to restore overrides even in scan-mode)
        const itsRes = await fetch(
          `/api/vendor/invoice-items?invoice_id=${encodeURIComponent(invoiceId)}`,
          { cache: "no-store" },
        );
        const itsJson = await itsRes.json().catch(() => ({}));
        if (!itsRes.ok || !itsJson?.ok)
          throw new Error(itsJson?.error || "Failed to load items");

        const mappedItems = ((itsJson.data || []) as InvoiceItemRow[]).map((it) => {
          const quantity = Number(it.quantity ?? 0);
          const unitPrice = Number(it.unit_price ?? 0);
          const discount = Number(it.discount ?? 0);

          return {
            ...it,
            brand: it.brand ?? "",
            hsn: it.hsn ?? "",
            quantity,
            unit_price: unitPrice,
            discount,
            discount_percent: discountPercentFromStored(discount, unitPrice, quantity),
          };
        });

        // If custom invoice -> use manual items UI
        if (customFlag) {
          if (!cancelled) setItems(mappedItems.length ? mappedItems : [createEmptyItem()]);
          if (!cancelled) {
            setScannedUnits([]);
            setLineOverrides({});
            originalUnitIdsRef.current = [];
          }
          return;
        }

        // Scan-mode invoice: load invoice_units (with nested product + brand)
        const iuRes = await fetch(
          `/api/vendor/invoice-units?invoice_id=${encodeURIComponent(invoiceId)}&withProduct=1`,
          { cache: "no-store" },
        );
        const iuJson = await iuRes.json().catch(() => ({}));
        if (!iuRes.ok || !iuJson?.ok)
          throw new Error(iuJson?.error || "Failed to load invoice units");
        const iUnits = (iuJson.data || []) as any[];

        if ((iUnits || []).length === 0 && mappedItems.length > 0) {
          if (!cancelled) {
            setIsCustom(true);
            setItems(mappedItems);
            setScannedUnits([]);
            setLineOverrides({});
            originalUnitIdsRef.current = [];
            setLoadWarning(
              "This invoice has no linked scanned units, but has saved items. Editing in manual mode. Saving will keep it as a custom invoice.",
            );
          }
          return;
        }

        const builtUnits: ScannedUnit[] = (iUnits || []).map((r: any) => {
          const p = r.products;
          const brandName = p?.brands?.name ?? "";
          const baseRate = Number(p?.compare_at_price ?? p?.price ?? 0);
          return {
            unit_id: r.unit_id,
            unit_code: r.unit_code,
            scan_code: r.scan_code || r.unit_code,
            display_code: getPublicScanCode(r),
            allocation_mode: r.scan_code && r.scan_code !== r.unit_code ? "shared_scan" : "legacy_exact",
            product_id: r.product_id,
            product_name: p?.name ?? "",
            brand_name: brandName,
            hsn: p?.hsn ?? "",
            base_rate: baseRate,
          };
        });

        // Map a scanned unit's product NAME -> product_id, so we can recover the
        // right product for a legacy invoice_item that lost its product_id but
        // still names a product that IS on the invoice (as scanned units). This
        // is what makes the edit page self-heal: such an item's rate/discount is
        // restored onto its product line (below), and it is NOT re-counted as an
        // additional charge (which is what doubled the totals on save).
        const norm = (s: string) =>
          (s || "").toLowerCase().replace(/\s+/g, " ").trim();
        const nameToProductId = new Map<string, string>();
        for (const u of builtUnits) {
          if (u.product_id && u.product_name) {
            nameToProductId.set(norm(u.product_name), u.product_id);
          }
        }
        // Resolve an item's product id: its own, else by matching a unit product.
        const resolveProductId = (it: any): string | null =>
          it.product_id || nameToProductId.get(norm(it.description)) || null;

        // restore overrides from invoice_items (unit_price + discount), keyed by
        // the resolved product id so name-only-matched items land correctly too.
        const ov: Record<string, LineOverride> = {};
        for (const it of mappedItems) {
          const pid = resolveProductId(it);
          if (!pid) continue;
          ov[pid] = {
            rate: Number(it.unit_price ?? 0),
            discountPercent: discountPercentFromStored(
              Number(it.discount ?? 0),
              Number(it.unit_price ?? 0),
              Number(it.quantity ?? 0),
            ),
            hsn: it.hsn ?? "",
          };
        }

        // Capture genuine non-product lines (freight/packing/etc.) so we can edit
        // and re-save them. Items that resolve to a scanned-unit product are NOT
        // charges — they are product lines already represented by the units.
        const chargeLines = mappedItems
          .filter((it) => !resolveProductId(it))
          .map((it) => ({
            id: it.id || crypto.randomUUID(),
            description: it.description || "",
            amount: round2(
              Number(it.quantity || 1) * Number(it.unit_price || 0) -
                Number(it.discount || 0),
            ),
          }));

        if (!cancelled) {
          setItems([createEmptyItem()]); // not used in scan-mode
          setScannedUnits(builtUnits);
          setLineOverrides(ov);
          setExtraCharges(chargeLines);
          originalUnitIdsRef.current = builtUnits.map((u) => u.unit_id);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load invoice");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  // ===== CUSTOM MODE calculations =====
  const customTotals = useMemo(() => {
    let sub = 0;
    let disc = 0;

    for (const item of items) {
      const lineBase = Number(item.quantity || 0) * Number(item.unit_price || 0);
      const lineDiscount = totalLineDiscountFromPercent(
        Number(item.unit_price || 0),
        Number(item.quantity || 0),
        Number(item.discount_percent || 0),
      );

      sub += lineBase;
      disc += lineDiscount;
    }

    return {
      subtotal: round2(sub),
      discountTotal: round2(disc),
      amountAfterDiscount: round2(sub - disc),
    };
  }, [items]);

  // ===== SCAN MODE: group scannedUnits -> lines (qty auto), rate+discount editable =====
  const scannedLines: InvoiceLine[] = useMemo(() => {
    const map = new Map<string, InvoiceLine>();

    for (const u of scannedUnits) {
      const ov = lineOverrides[u.product_id] || {};
      const rate = Number.isFinite(Number(ov.rate)) ? Number(ov.rate) : u.base_rate;
      const discountPercent = Number.isFinite(Number(ov.discountPercent))
        ? Number(ov.discountPercent)
        : 0;

      const hsn = typeof ov.hsn === "string" ? ov.hsn : u.hsn;

      const existing = map.get(u.product_id);
      if (!existing) {
        const qty = 1;
        const discountAmount = totalLineDiscountFromPercent(rate, qty, discountPercent);
        const amount = qty * rate - discountAmount;
        map.set(u.product_id, {
          product_id: u.product_id,
          description: u.product_name,
          brand: u.brand_name,
          hsn,
          rate,
          qty,
          discountPercent,
          discountAmount,
          amount: round2(amount),
        });
      } else {
        const qty = existing.qty + 1;
        const discountAmount = totalLineDiscountFromPercent(rate, qty, discountPercent);
        const amount = qty * rate - discountAmount;
        map.set(u.product_id, {
          ...existing,
          hsn,
          rate,
          qty,
          discountPercent,
          discountAmount,
          amount: round2(amount),
        });
      }
    }

    return Array.from(map.values());
  }, [scannedUnits, lineOverrides]);

  const scanTotals = useMemo(() => {
    let sub = 0;
    let disc = 0;

    for (const l of scannedLines) {
      sub += l.qty * l.rate;
      disc += Number(l.discountAmount || 0);
    }
    const extra = extraCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0);

    return {
      subtotal: round2(sub + extra),
      discountTotal: round2(disc),
      amountAfterDiscount: round2(sub - disc + extra),
    };
  }, [scannedLines, extraCharges]);

  const activeTotals = isCustom ? customTotals : scanTotals;

  const { taxableAmount, cgstAmount, sgstAmount, igstAmount, taxTotal, grandTotal } = useMemo(
    () =>
      extractInclusiveTaxAmounts(
        activeTotals.amountAfterDiscount,
        taxType,
        cgstPercent,
        sgstPercent,
        igstPercent,
        taxInclusive,
      ),
    [
      activeTotals.amountAfterDiscount,
      taxType,
      taxInclusive,
      cgstPercent,
      sgstPercent,
      igstPercent,
    ],
  );

  // ===== Custom item ops =====
  const updateItem = (id: string, patch: Partial<InvoiceItemRow>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };
  const addItem = () => setItems((prev) => [...prev, createEmptyItem()]);
  const removeItem = (id: string) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)));

  // suggestions (kept; not used in scan flow)
  const fetchProductSuggestions = async (itemId: string, query: string) => {
    if (isCustom) return;

    const q = query.trim();
    if (q.length < 2) {
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

    const res = await fetch(
      `/api/vendor/invoice-builder?mode=product-search&q=${encodeURIComponent(q)}`,
      { cache: "no-store" },
    );
    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json?.ok) {
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

    const data = json.data || [];
    const mapped: ProductSuggestion[] = (data || []).map((p: any) => {
      const mrp =
        p.compare_at_price != null
          ? Number(p.compare_at_price)
          : p.price != null
            ? Number(p.price)
            : null;

      return {
        id: p.id,
        name: p.name,
        hsn: p.hsn ?? null,
        mrp,
        brandName: p.brands?.name ?? null,
      };
    });

    setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: mapped }));
  };

  // ===== Scan operations =====
  const groupedSelectedCodes = useMemo(() => {
    const map = new Map<string, { count: number; isShared: boolean; title: string }>();

    for (const u of scannedUnits) {
      const key = u.display_code || u.unit_code;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          count: 1,
          isShared: u.allocation_mode === "shared_scan",
          title: `${u.product_name} • ${u.brand_name}`.trim(),
        });
      }
    }

    return Array.from(map.entries()).map(([code, meta]) => ({ code, ...meta }));
  }, [scannedUnits]);

  async function fetchProductsByIds(productIds: string[]) {
    const uniq = Array.from(new Set(productIds.filter(Boolean)));
    if (uniq.length === 0) return new Map<string, any>();

    const res = await fetch(
      `/api/vendor/invoice-builder?mode=products-by-ids&ids=${encodeURIComponent(uniq.join(","))}`,
      { cache: "no-store" },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load products");

    return new Map((json.data || []).map((row: any) => [row.id, row]));
  }

  async function addUnitByCode(rawCode: string, requestedQtyRaw?: number) {
    const enteredCode = rawCode.trim();
    const requestedQty = Math.max(1, Math.floor(Number(requestedQtyRaw || 1) || 1));
    if (!enteredCode) return;

    if (!invoiceId) return;

    setError(null);
    setScanAvailability("");

    const selectedUnitIds = new Set(scannedUnits.map((u) => u.unit_id));

    if (hasLegacySequenceSuffix(enteredCode)) {
      if (scannedUnits.some((u) => u.unit_code === enteredCode)) {
        setScanAvailability("This exact unit is already selected.");
        return;
      }

      const unitRes = await fetch(
        `/api/vendor/invoice-builder?mode=unit-by-code&code=${encodeURIComponent(enteredCode)}&status=IN_STOCK`,
        { cache: "no-store" },
      );
      const unitJson = await unitRes.json().catch(() => ({}));
      if (!unitRes.ok || !unitJson?.ok) throw new Error(unitJson?.error || "Lookup failed");
      let unit = unitJson.data as any;

      if (!unit) {
        const fbRes = await fetch(
          `/api/vendor/invoice-builder?mode=unit-by-code&code=${encodeURIComponent(enteredCode)}&sold_invoice_id=${encodeURIComponent(invoiceId)}`,
          { cache: "no-store" },
        );
        const fbJson = await fbRes.json().catch(() => ({}));
        if (!fbRes.ok || !fbJson?.ok) throw new Error(fbJson?.error || "Lookup failed");
        unit = fbJson.data;
      }

      if (!unit) return setError("Unit not found.");

      // Defense in depth: reject units already linked to ANOTHER invoice
      // (orphan state where inventory_units.status update failed).
      const linkRes = await fetch(
        `/api/vendor/invoice-builder?mode=unit-links&unitIds=${encodeURIComponent(unit.id)}`,
        { cache: "no-store" },
      );
      const linkJson = await linkRes.json().catch(() => ({}));
      const linkedElsewhere = (linkJson?.data || []).some(
        (x: any) => x.invoice_id !== invoiceId,
      );
      if (linkedElsewhere) {
        return setError("This unit is already linked to another invoice.");
      }

      const productMap = await fetchProductsByIds([unit.product_id]);
      const product = productMap.get(unit.product_id);
      if (!product) return setError("Product not found for unit.");

      setScannedUnits((prev) => [
        ...prev,
        {
          unit_id: unit.id,
          unit_code: unit.unit_code,
          scan_code: unit.scan_code || unit.unit_code,
          display_code: getPublicScanCode(unit),
          allocation_mode: unit.scan_code && unit.scan_code !== unit.unit_code ? "shared_scan" : "legacy_exact",
          product_id: unit.product_id,
          product_name: product?.name ?? "",
          brand_name: product?.brands?.name ?? "",
          hsn: product?.hsn ?? "",
          base_rate: Number(product?.compare_at_price ?? product?.price ?? 0),
        },
      ]);

      setScanCode("");
      setScanQty(1);
      setScanAvailability("1 unit selected.");
      return;
    }

    const rowsRes = await fetch(
      `/api/vendor/invoice-builder?mode=units-by-scan&code=${encodeURIComponent(enteredCode)}&status=IN_STOCK`,
      { cache: "no-store" },
    );
    const rowsJson = await rowsRes.json().catch(() => ({}));
    if (!rowsRes.ok || !rowsJson?.ok) throw new Error(rowsJson?.error || "Lookup failed");
    const rows = (rowsJson.data || []) as any[];

    const ownedRes = await fetch(
      `/api/vendor/invoice-builder?mode=units-by-scan&code=${encodeURIComponent(enteredCode)}&sold_invoice_id=${encodeURIComponent(invoiceId)}`,
      { cache: "no-store" },
    );
    const ownedJson = await ownedRes.json().catch(() => ({}));
    if (!ownedRes.ok || !ownedJson?.ok) throw new Error(ownedJson?.error || "Lookup failed");
    const ownedRows = (ownedJson.data || []) as any[];

    const combined = [...(rows || []), ...(ownedRows || [])];
    const deduped = Array.from(new Map(combined.map((row: any) => [row.id, row])).values());

    // Defense in depth: drop any unit already linked to ANOTHER invoice.
    const candidateIds = deduped.map((r: any) => r.id);
    const otherInvoiceIds = new Set<string>();
    if (candidateIds.length > 0) {
      const linksRes = await fetch(
        `/api/vendor/invoice-builder?mode=unit-links&unitIds=${encodeURIComponent(candidateIds.join(","))}`,
        { cache: "no-store" },
      );
      const linksJson = await linksRes.json().catch(() => ({}));
      (linksJson?.data || []).forEach((x: any) => {
        if (x.invoice_id !== invoiceId) otherInvoiceIds.add(x.unit_id);
      });
    }

    const allocatable = sortUnitsForAllocation(
      deduped.filter(
        (row: any) => !selectedUnitIds.has(row.id) && !otherInvoiceIds.has(row.id),
      ),
    );
    const availableCount = allocatable.length;

    if (availableCount === 0) {
      setError("No remaining quantity available for this code.");
      return;
    }

    const picked = allocatable.slice(0, requestedQty);
    const productMap = await fetchProductsByIds(picked.map((row: any) => row.product_id));

    setScannedUnits((prev) => [
      ...prev,
      ...picked.map((row: any) => {
        const product = productMap.get(row.product_id);
        return {
          unit_id: row.id,
          unit_code: row.unit_code,
          scan_code: row.scan_code || row.unit_code,
          display_code: getPublicScanCode(row),
          allocation_mode: "shared_scan" as InventoryCodeMode,
          product_id: row.product_id,
          product_name: product?.name ?? "",
          brand_name: product?.brands?.name ?? "",
          hsn: product?.hsn ?? "",
          base_rate: Number(product?.compare_at_price ?? product?.price ?? 0),
        };
      }),
    ]);

    setScanAvailability(
      picked.length < requestedQty
        ? `Only ${picked.length} selected. ${availableCount - picked.length} remaining after this add.`
        : `${Math.max(availableCount - picked.length, 0)} remaining after this add.`
    );
    setScanCode("");
    setScanQty(1);
  }

  function removeUnit(codeToRemove: string) {
    setScannedUnits((prev) => {
      const idx = [...prev]
        .map((u, index) => ({ u, index }))
        .reverse()
        .find(({ u }) => (u.allocation_mode === "shared_scan" ? u.display_code === codeToRemove : u.unit_code === codeToRemove))?.index;

      if (idx == null) return prev;
      return prev.filter((_, index) => index !== idx);
    });
  }

  function removeProductLine(productId: string) {
    setScannedUnits((prev) => prev.filter((u) => u.product_id !== productId));
  }

  // ===== Save =====
  const handleSave = async () => {
    setError(null);
    if (!invoice) return;

    const fail = (m: string) => {
      setError(m);
      toast.error(m);
    };

    if (!customerName.trim()) return fail("Please enter customer name.");
    if (!billingAddress.trim()) return fail("Please enter billing address.");
    if (!phone.trim()) return fail("Please enter customer mobile number.");

    if (isCustom) {
      if (items.every((it) => !it.description.trim()))
        return fail("Please enter at least one line item description.");
    } else if (
      scannedUnits.length === 0 &&
      !extraCharges.some((c) => c.description.trim() || Number(c.amount) > 0)
    ) {
      return fail("Scan at least one unit or add an additional charge.");
    }

    setSaving(true);

    try {
      // Build line items (prices/discounts snapshotted; same shape as before).
      const lineItems = isCustom
        ? items
            .filter((it) => it.description.trim())
            .map((it, index) => {
              const lineDiscount = totalLineDiscountFromPercent(
                Number(it.unit_price || 0),
                Number(it.quantity || 0),
                Number(it.discount_percent || 0),
              );
              const gross =
                Number(it.quantity || 0) * Number(it.unit_price || 0);
              return {
                product_id: it.product_id ?? null,
                brand: (it.brand || "").trim() ? it.brand : null,
                description: it.description,
                hsn: (it.hsn || "").trim() ? it.hsn : null,
                quantity: Number(it.quantity || 0),
                unit_price: Number(it.unit_price || 0),
                discount: lineDiscount,
                line_subtotal: round2(gross),
                line_total: round2(gross - lineDiscount),
                position: index,
              };
            })
        : scannedLines.map((l, index) => {
            const gross = l.qty * l.rate;
            return {
              product_id: l.product_id,
              brand: l.brand || null,
              description: l.description,
              hsn: l.hsn || null,
              quantity: l.qty,
              unit_price: l.rate,
              discount: l.discountAmount,
              line_subtotal: round2(gross),
              line_total: round2(gross - l.discountAmount),
              position: index,
            };
          });

      // Manual charge lines (scan mode) — preserved/edited as non-product items.
      const extraItems = isCustom
        ? []
        : extraCharges
            .filter((c) => c.description.trim() || Number(c.amount) > 0)
            .map((c, i) => {
              const amt = round2(Number(c.amount) || 0);
              return {
                product_id: null,
                brand: null,
                description: c.description.trim() || "Additional charge",
                hsn: null,
                quantity: 1,
                unit_price: amt,
                discount: 0,
                line_subtotal: amt,
                line_total: amt,
                position: scannedLines.length + i,
              };
            });
      const allItems = [...lineItems, ...extraItems];

      const unitsPayload = isCustom
        ? []
        : scannedUnits.map((u) => ({
            unit_id: u.unit_id,
            unit_code: u.unit_code,
            scan_code: u.scan_code || u.display_code || u.unit_code,
            product_id: u.product_id,
          }));

      const payload = {
        header: {
          company_id: companyId || invoice.company_id,
          invoice_number: invoiceNumber.trim() || invoice.invoice_number,
          invoice_date: invoiceDate || null,
          due_date: dueDate || null,
          customer_name: customerName,
          billing_address: billingAddress || null,
          bill_to_address_id: selectedAddressId || null,
          phone: phone || null,
          email: email || null,
          gst_number: gstNumber || null,
          pan_number: panNumber || null,
          notes: notes || null,
          subtotal: activeTotals.subtotal,
          discount_total: activeTotals.discountTotal,
          tax_type: taxType,
          tax_inclusive: taxInclusive,
          cgst_percent: taxType === "CGST_SGST" ? cgstPercent : 0,
          sgst_percent: taxType === "CGST_SGST" ? sgstPercent : 0,
          igst_percent: taxType === "IGST" ? igstPercent : 0,
          cgst_amount: cgstAmount,
          sgst_amount: sgstAmount,
          igst_amount: igstAmount,
          tax_amount: taxTotal,
          grand_total: grandTotal,
          total_amount: grandTotal,
          is_custom: isCustom,
        },
        items: allItems,
        units: unitsPayload,
      };

      // Single atomic call: header + items + units + unit revert/sell, all-or-nothing.
      const updateRes = await fetch("/api/vendor/invoices/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p_invoice_id: invoiceId, payload }),
      });
      const updateData = await updateRes.json().catch(() => ({}));
      if (!updateRes.ok || !updateData?.ok)
        throw new Error(updateData?.error || "Failed to update invoice");

      // keep original set in sync if the user keeps editing this session
      originalUnitIdsRef.current = scannedUnits.map((u) => u.unit_id);

      toast.success("Invoice updated successfully.");
      // replace (not push) so Back returns to where the user came from
      // (list or invoice view), not back into the edit form.
      router.replace(`/vendor/invoices/${invoiceId}`);
    } catch (e: any) {
      fail(e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-10 text-sm text-muted-foreground">
        Loading invoice…
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="container mx-auto py-10">
        <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
        <div className="mt-4">
          <Button variant="outline" onClick={() => router.push("/vendor/invoices")}>
            ← Back to Invoices
          </Button>
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1)
              router.back();
            else router.push(`/vendor/invoices/${invoiceId}`);
          }}
        >
          ← Back
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !isAdmin}
            title={isViewer ? "View-only access" : undefined}
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Edit Invoice</CardTitle>
<CardDescription>Edit invoice details, company, and totals.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {loadWarning && (
            <div className="rounded-md border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {loadWarning}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Seller preview */}
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-medium">{sellerName}</div>
            <div className="text-xs text-muted-foreground">
              Support: {sellerEmail} • GSTIN: {sellerGstin}
            </div>
          </div>

          {/* Invoice meta */}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <Label>Invoice Company</Label>
              <Select value={companyId || undefined} onValueChange={setCompanyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Invoice Number</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label>Invoice Date</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* Bill To Address (prefill) — same dropdown as the create page */}
          <div className="border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <Label>Bill To Address (prefill)</Label>
              <div className="flex items-center gap-2">
                <QuickAddAddressDialog
                  triggerText="Quick Add"
                  onCreated={(created) => {
                    setAddresses((prev) => [created as any, ...prev]);
                    setSelectedAddressId(created.id);
                    applyAddressToCustomerFields(created as any);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/vendor/addresses")}
                >
                  Manage
                </Button>
              </div>
            </div>
            <AddressSearchSelect
              addresses={addresses}
              value={selectedAddressId}
              onSelect={(id, addr) => {
                setSelectedAddressId(id);
                if (addr) applyAddressToCustomerFields(addr);
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Select an address to auto-fill Customer Details and Billing Address.
            </p>
          </div>

          {/* Customer */}
          <div className="border-t pt-4">
            <h3 className="mb-2 text-base font-semibold">Customer Details</h3>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Customer Name</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Customer Email (optional)</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Mobile Number</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>GST No (Customer)</Label>
                <Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>PAN Number (Customer)</Label>
                <Input value={panNumber} onChange={(e) => setPanNumber(e.target.value)} />
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <Label>Billing Address</Label>
              <Textarea value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} rows={3} />
            </div>
          </div>

          {/* Scan section */}
          {!isCustom && (
            <div className="border-t pt-4 space-y-3">
              <h3 className="text-base font-semibold">Units</h3>

              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto] md:items-end">
                <div>
                  <label className="text-sm font-medium">Scan Unit QR / Unit Code</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-2"
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                    placeholder="Scan legacy unit code or new shared code"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addUnitByCode(scanCode, scanQty);
                    }}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Qty</label>
                  <Input
                    type="number"
                    min={1}
                    step="1"
                    value={String(scanQty)}
                    onChange={(e) => setScanQty(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>

                <button type="button" className="border rounded px-4 py-2 h-10" onClick={() => addUnitByCode(scanCode, scanQty)}>
                  Add
                </button>
              </div>

              {scanAvailability && <p className="text-xs text-slate-600">{scanAvailability}</p>}

              <div className="flex flex-wrap gap-2">
                {groupedSelectedCodes.map((u) => (
                  <span
                    key={u.code}
                    className="flex max-w-[280px] flex-col gap-0.5 rounded border px-2 py-1 text-xs"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono">
                        {u.code}
                        {u.count > 1 ? ` × ${u.count}` : ""}
                      </span>
                      <button
                        type="button"
                        className="text-red-600"
                        onClick={() => removeUnit(u.code)}
                        aria-label={`Remove ${u.code}`}
                      >
                        ×
                      </button>
                    </span>
                    {u.title && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {u.title}
                      </span>
                    )}
                  </span>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Removing a unit here updates only the draft on screen. Removed units go back to IN_STOCK when you save.
              </p>
            </div>
          )}

          {/* Items */}
          <div className="border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Invoice Items</h3>

              {isCustom ? (
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  + Add Item
                </Button>
              ) : (
                <div className="text-xs text-muted-foreground">Items are generated from scanned units</div>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-2 py-2 text-left w-[60px]">Sl.No</th>
                    <th className="px-2 py-2 text-left">Brand</th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-left w-[120px]">HSN</th>
                    <th className="px-2 py-2 text-right w-[90px]">Qty</th>
                    <th className="px-2 py-2 text-right w-[120px]">MRP</th>
                    <th className="px-2 py-2 text-right w-[120px]">Discount %</th>
                    <th className="px-2 py-2 text-right w-[160px]">Per Unit After Discount</th>
                    <th className="px-2 py-2 text-right w-[140px]">Amount</th>
                    <th className="px-2 py-2 text-center w-[90px] print:hidden">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {isCustom ? (
                    items.map((item, idx) => {
                      const lineDiscount = totalLineDiscountFromPercent(
                        Number(item.unit_price || 0),
                        Number(item.quantity || 0),
                        Number(item.discount_percent || 0),
                      );
                      const lineAmount =
                        Number(item.quantity || 0) * Number(item.unit_price || 0) - lineDiscount;

                      return (
                        <tr key={item.id} className="border-t align-top">
                          <td className="px-2 py-2">{idx + 1}</td>

                          <td className="px-2 py-2">
                            <Input
                              value={item.brand ?? ""}
                              onChange={(e) => updateItem(item.id, { brand: e.target.value })}
                              placeholder="Brand"
                            />
                          </td>

                          <td className="px-2 py-2 relative">
                            <Input
                              value={item.description}
                              onFocus={() => !isCustom && setActiveSuggestForItemId(item.id)}
                              onBlur={() => {
                                setTimeout(() => {
                                  setActiveSuggestForItemId((prev) => (prev === item.id ? null : prev));
                                  setProductSuggestionsByItem((prev) => ({ ...prev, [item.id]: [] }));
                                }, 150);
                              }}
                              onChange={(e) => {
                                const v = e.target.value;

                                updateItem(item.id, {
                                  description: v,
                                  product_id: isCustom ? item.product_id : null,
                                });

                                if (!isCustom) {
                                  setActiveSuggestForItemId(item.id);
                                  fetchProductSuggestions(item.id, v);
                                }
                              }}
                              placeholder={isCustom ? "Product name" : "Search website product..."}
                            />

                            {!isCustom &&
                              activeSuggestForItemId === item.id &&
                              (productSuggestionsByItem[item.id]?.length || 0) > 0 && (
                                <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-sm max-h-60 overflow-auto">
                                  {productSuggestionsByItem[item.id].map((p: any) => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-3"
                                      onMouseDown={(ev) => ev.preventDefault()}
                                      onClick={() => {
                                        updateItem(item.id, {
                                          description: p.name,
                                          product_id: p.id,
                                          brand: p.brandName ?? "",
                                          hsn: p.hsn ?? "",
                                          unit_price: p.mrp ?? 0,
                                        });

                                        setProductSuggestionsByItem((prev) => ({ ...prev, [item.id]: [] }));
                                        setActiveSuggestForItemId(null);
                                      }}
                                    >
                                      <span className="truncate">{p.name}</span>
                                      <span className="text-xs text-slate-600">
                                        {p.mrp != null ? fmtINR(p.mrp) : ""}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                          </td>

                          <td className="px-2 py-2">
                            <Input
                              value={item.hsn ?? ""}
                              onChange={(e) => updateItem(item.id, { hsn: e.target.value })}
                              placeholder="HSN"
                            />
                          </td>

                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              value={String(item.quantity)}
                              onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })}
                            />
                          </td>

                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(item.unit_price)}
                              onChange={(e) => updateItem(item.id, { unit_price: Number(e.target.value) || 0 })}
                            />
                          </td>

                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(Number(item.discount_percent ?? 0))}
                              onChange={(e) =>
                                updateItem(item.id, { discount_percent: Number(e.target.value) || 0 })
                              }
                            />
                          </td>

                          {/* Editable net price per unit -> auto-derives Discount % (commits on blur) */}
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              className="text-right"
                              value={
                                netDraft[item.id] ??
                                String(
                                  perUnitAfterDiscountFromPercent(
                                    Number(item.unit_price || 0),
                                    Number(item.discount_percent || 0),
                                  ),
                                )
                              }
                              onChange={(e) =>
                                setNetDraft((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              onBlur={() =>
                                commitNet(item.id, Number(item.unit_price || 0), (pct) =>
                                  updateItem(item.id, { discount_percent: pct }),
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  (e.target as HTMLInputElement).blur();
                              }}
                            />
                          </td>

                          <td className="px-2 py-2 text-right font-medium">{fmtINR(lineAmount)}</td>

                          <td className="px-2 py-2 text-center print:hidden">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeItem(item.id)}
                              disabled={items.length <= 1}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  ) : scannedLines.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No units linked to this invoice. Scan a unit code above to add line items.
                      </td>
                    </tr>
                  ) : (
                    scannedLines.map((l, idx) => (
                      <tr key={l.product_id} className="border-t align-top">
                        <td className="px-2 py-2">{idx + 1}</td>

                        <td className="px-2 py-2">
                          <Input value={l.brand} disabled />
                        </td>

                        <td className="px-2 py-2">
                          <Input value={l.description} disabled />
                        </td>

                        <td className="px-2 py-2">
                          <Input
                            value={l.hsn}
                            onChange={(e) => setLineHsn(l.product_id, e.target.value)}
                            placeholder="HSN"
                          />
                        </td>

                        <td className="px-2 py-2">
                          <Input value={String(l.qty)} disabled />
                        </td>

                        {/* ✅ Editable MRP */}
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(l.rate)}
                            onChange={(e) => setLineRate(l.product_id, Number(e.target.value) || 0)}
                          />
                        </td>

                        {/* ✅ Editable Discount */}
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(Number(lineOverrides[l.product_id]?.discountPercent ?? l.discountPercent ?? 0))}
                            onChange={(e) =>
                              setLineDiscountPercent(l.product_id, Number(e.target.value) || 0)
                            }
                          />
                        </td>

                        {/* Editable net price per unit -> auto-derives Discount % (commits on blur) */}
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="text-right"
                            value={
                              netDraft[l.product_id] ??
                              String(
                                perUnitAfterDiscountFromPercent(
                                  l.rate,
                                  Number(
                                    lineOverrides[l.product_id]?.discountPercent ??
                                      l.discountPercent ??
                                      0,
                                  ),
                                ),
                              )
                            }
                            onChange={(e) =>
                              setNetDraft((prev) => ({
                                ...prev,
                                [l.product_id]: e.target.value,
                              }))
                            }
                            onBlur={() =>
                              commitNet(l.product_id, l.rate, (pct) =>
                                setLineDiscountPercent(l.product_id, pct),
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                (e.target as HTMLInputElement).blur();
                            }}
                          />
                        </td>

                        <td className="px-2 py-2 text-right font-medium">{fmtINR(l.amount)}</td>

                        <td className="px-2 py-2 text-center print:hidden">
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeProductLine(l.product_id)}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Additional charges (scan mode) */}
            {!isCustom && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Additional Charges</h4>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addExtraCharge}
                  >
                    + Add charge
                  </Button>
                </div>
                {extraCharges.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Add freight, packing, installation or other charges (optional).
                  </p>
                ) : (
                  <div className="space-y-2">
                    {extraCharges.map((c) => (
                      <div key={c.id} className="flex items-center gap-2">
                        <Input
                          className="flex-1"
                          placeholder="Charge description (e.g. Freight)"
                          value={c.description}
                          onChange={(e) =>
                            updateExtraCharge(c.id, { description: e.target.value })
                          }
                        />
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-36 text-right"
                          placeholder="Amount"
                          value={String(c.amount)}
                          onChange={(e) =>
                            updateExtraCharge(c.id, {
                              amount: Number(e.target.value) || 0,
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-red-600"
                          onClick={() => removeExtraCharge(c.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Totals */}
            <div className="mt-4 flex flex-col items-end space-y-1 text-sm">
              <div className="flex w-full max-w-sm justify-between">
                <span>Subtotal</span>
                <span>{fmtINR(activeTotals.subtotal)}</span>
              </div>

              <div className="flex w-full max-w-sm justify-between">
                <span>Discount</span>
                <span>{fmtINR(activeTotals.discountTotal)}</span>
              </div>

              <div className="flex w-full max-w-sm justify-between">
                <span className="text-muted-foreground">Taxable Amount</span>
                <span className="font-medium">{fmtINR(taxableAmount)}</span>
              </div>

              {taxType === "CGST_SGST" && (
                <>
                  <div className="flex w-full max-w-sm justify-between">
                    <span>CGST</span>
                    <span>{fmtINR(cgstAmount)}</span>
                  </div>
                  <div className="flex w-full max-w-sm justify-between">
                    <span>SGST</span>
                    <span>{fmtINR(sgstAmount)}</span>
                  </div>
                </>
              )}

              {taxType === "IGST" && (
                <div className="flex w-full max-w-sm justify-between">
                  <span>IGST</span>
                  <span>{fmtINR(igstAmount)}</span>
                </div>
              )}

              <div className="flex w-full max-w-sm justify-between font-semibold border-t pt-2 mt-2">
                <span>Invoice Amount</span>
                <span>{fmtINR(grandTotal)}</span>
              </div>

              <div className="w-full max-w-sm pt-1 text-right text-xs text-muted-foreground">
                {numberToIndianWords(grandTotal)}
              </div>
            </div>

            {/* Tax config */}
            <div className="mt-4 w-full max-w-sm rounded-md border p-3 text-sm">
              <div className="font-semibold mb-2">Tax</div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Type</span>
                <select
                  value={taxType}
                  onChange={(e) => setTaxType(e.target.value as TaxType)}
                  className="border rounded-md px-2 py-1 text-sm"
                >
                  <option value="CGST_SGST">CGST + SGST</option>
                  <option value="IGST">IGST</option>
                  <option value="NONE">No Tax</option>
                </select>
              </div>

              {taxType !== "NONE" && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">In grand total</span>
                  <select
                    value={taxInclusive ? "inclusive" : "exclusive"}
                    onChange={(e) =>
                      setTaxInclusive(e.target.value === "inclusive")
                    }
                    className="border rounded-md px-2 py-1 text-sm"
                  >
                    <option value="inclusive">Included (within total)</option>
                    <option value="exclusive">Excluded (added on top)</option>
                  </select>
                </div>
              )}

              {taxType === "CGST_SGST" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">CGST %</div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={cgstPercent.toString()}
                      onChange={(e) => setCgstPercent(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">SGST %</div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={sgstPercent.toString()}
                      onChange={(e) => setSgstPercent(Number(e.target.value) || 0)}
                    />
                  </div>
                </div>
              )}

              {taxType === "IGST" && (
                <div className="mt-2">
                  <div className="text-xs text-muted-foreground mb-1">IGST %</div>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={igstPercent.toString()}
                    onChange={(e) => setIgstPercent(Number(e.target.value) || 0)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="border-t pt-4">
            <div className="space-y-1">
              <Label>Notes / Internal Reference</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sticky action bar — always-visible total + save */}
      <div className="sticky bottom-4 z-20 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-lg font-bold">{fmtINR(grandTotal)}</span>
            <span className="ml-2 text-muted-foreground">
              {(isCustom ? items.length : scannedLines.length + extraCharges.length)}{" "}
              line items
              {!isCustom ? ` · ${scannedUnits.length} units` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              Print
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !isAdmin}
              title={isViewer ? "View-only access" : undefined}
            >
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
