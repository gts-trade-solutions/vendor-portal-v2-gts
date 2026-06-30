// app/vendor/(protected)/invoices/new/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { QuickAddAddressDialog } from "@/components/addresses/QuickAddAddressDialog";
import {
  calculateInclusiveTaxBreakdown,
  calculateInvoiceLineTotals,
  calculateLineAmounts,
  round2,
  numberToIndianWords,
} from "@/lib/invoice-calculations";

const SUPPORT_EMAIL_FALLBACK = "info@madenkorea.com";

type InvoiceCompany = {
  id: string;
  key: string;
  display_name: string;
  address: string | null;
  gst_number: string | null;
  email: string | null;
};

type TaxType = "CGST_SGST" | "IGST" | "NONE";

type ProductSuggestion = {
  id: string;
  name: string;
  brand_name: string | null;
  hsn: string | null;
  mrp: number | null;
};

type InvoiceItem = {
  id: string;
  product_id?: string | null;
  brand: string;
  description: string;
  hsn: string;
  mrp: number; // ✅ ONLY price column used for calculations
  quantity: number;
  discount: number;
};

type InvoiceAddress = {
  id: string;
  vendor_id: string;
  label: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  created_at?: string;
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
  rate: number;
};

type InvoiceLine = {
  product_id: string;
  description: string;
  brand: string;
  hsn: string;
  rate: number;
  qty: number;
  discountPercent: number;
  totalDiscount: number;
  amount: number;
};

const DEFAULT_NOTES = `Payment Terms
• Payment is due within 30 days from the invoice date.

Reseller Disclaimer
We are resellers and are not responsible for product usage or handling guidance. For detailed information on how to use the product safely and effectively, please contact the product manufacturer directly.

Return Policy
• Returns are accepted within 3 days from the date of delivery.
• Returns are only accepted for products with damaged packaging or expired items.
• Used products or items with broken or tampered seals are not eligible for return.`;

// ✅ INR format with Indian commas
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtINR = (v: any) =>
  inr.format(Number.isFinite(Number(v)) ? Number(v) : 0);

function createEmptyItem(): InvoiceItem {
  return {
    id: crypto.randomUUID(),
    product_id: null,
    brand: "",
    description: "",
    hsn: "",
    mrp: 0,
    quantity: 1,
    discount: 0,
  };
}

// Add N days to a YYYY-MM-DD string and return YYYY-MM-DD.
function addDaysToYmd(ymd: string, days: number) {
  if (!ymd) return "";
  const d = new Date(ymd);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function NewInvoicePage() {
  const router = useRouter();
  const { isAdmin, isViewer } = useVendorRole();

  // ✅ Scan states (web-generated mode)
  const [scanCode, setScanCode] = useState("");
  const [scanQty, setScanQty] = useState<number>(1);
  const [scanAvailability, setScanAvailability] = useState<string>("");
  const [scannedUnits, setScannedUnits] = useState<ScannedUnit[]>([]);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Additional manual charges (freight, packing, service, etc.)
  const [extraCharges, setExtraCharges] = useState<
    { id: string; description: string; amount: number }[]
  >([]);

  type LineOverride = {
    rate?: number;
    discount?: number; // editable discount percentage
  };

  const [lineOverrides, setLineOverrides] = useState<
    Record<string, LineOverride>
  >({});

  const setLineRate = (productId: string, rate: number) => {
    setLineOverrides((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), rate },
    }));
  };

  const setLineDiscount = (productId: string, discount: number) => {
    setLineOverrides((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), discount },
    }));
  };

  // Free-typing buffer for the editable "net price per unit" field, so typing
  // isn't fought by the derived value recomputing on every keystroke.
  const [netDraft, setNetDraft] = useState<Record<string, string>>({});
  const commitNetPrice = (productId: string, rate: number) => {
    const raw = netDraft[productId];
    setNetDraft((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    if (raw === undefined || raw === "") return;
    const net = Number(raw);
    const pct =
      rate > 0 && Number.isFinite(net)
        ? Math.min(100, Math.max(0, round2((1 - net / rate) * 100)))
        : 0;
    setLineDiscount(productId, pct);
  };

  const [taxType, setTaxType] = useState<TaxType>("CGST_SGST");
  const [cgstPercent, setCgstPercent] = useState<number>(9);
  const [sgstPercent, setSgstPercent] = useState<number>(9);
  const [igstPercent, setIgstPercent] = useState<number>(18);

  const [companies, setCompanies] = useState<InvoiceCompany[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState<boolean>(false);

  // ✅ Mode: Custom vs Web Generated
  const [isCustom] = useState<boolean>(false);

  // ✅ Saved addresses + selection
  const [addresses, setAddresses] = useState<InvoiceAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");

  // ✅ Suggestions per-row (kept for safety; you can later remove entirely if you want scanning-only)
  const [productSuggestionsByItem, setProductSuggestionsByItem] = useState<
    Record<string, ProductSuggestion[]>
  >({});
  const [activeSuggestForItemId, setActiveSuggestForItemId] = useState<
    string | null
  >(null);

  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // --- Invoice form state ---
  const [companyId, setCompanyId] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  // Payment terms in days; auto-fills Due Date = Invoice Date + N. "custom" = manual.
  const [paymentTermsDays, setPaymentTermsDays] = useState<number | "custom">(30);
  const [invoiceNumber, setInvoiceNumber] = useState<string>("");

  const [customerName, setCustomerName] = useState<string>("");
  const [billingAddress, setBillingAddress] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [gstNumber, setGstNumber] = useState<string>("");
  const [panNumber, setPanNumber] = useState<string>("");

  const [notes, setNotes] = useState<string>(DEFAULT_NOTES);

  // ✅ Manual items (custom flow)
  const [items, setItems] = useState<InvoiceItem[]>([createEmptyItem()]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === companyId) ?? null,
    [companies, companyId],
  );

  // --- Load companies ---
  useEffect(() => {
    const loadCompanies = async () => {
      setLoadingCompanies(true);

      try {
        const res = await fetch("/api/vendor/invoice-companies", {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        const data = (json?.data || []) as InvoiceCompany[];
        if (!res.ok || !json?.ok) {
          console.error("Error loading invoice_companies", json?.error);
        } else {
          setCompanies(data);
          if (data.length > 0) setCompanyId(data[0].id);
        }
      } catch (e) {
        console.error("Error loading invoice_companies", e);
      }

      setLoadingCompanies(false);
    };

    loadCompanies();

    const today = new Date().toISOString().slice(0, 10);
    setInvoiceDate(today);
  }, []);

  // Auto-fill Due Date from the selected payment term (skip when set to custom).
  useEffect(() => {
    if (paymentTermsDays === "custom" || !invoiceDate) return;
    setDueDate(addDaysToYmd(invoiceDate, paymentTermsDays));
  }, [invoiceDate, paymentTermsDays]);

  // --- Load invoice addresses (vendor-scoped) ---
  useEffect(() => {
    const loadAddresses = async () => {
      try {
        const res = await fetch("/api/vendor/invoice-addresses", {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          console.error("Error loading invoice_addresses", json?.error);
          setAddresses([]);
        } else {
          setAddresses((json.data || []) as InvoiceAddress[]);
        }
      } catch (e) {
        console.error("Error loading invoice_addresses", e);
        setAddresses([]);
      }
    };

    loadAddresses();
  }, []);

  // Keep the scan field focused for fast barcode entry.
  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  // ✅ Manual items operations (custom flow)
  const updateItem = (id: string, patch: Partial<InvoiceItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  };

  const addItem = () => setItems((prev) => [...prev, createEmptyItem()]);

  const removeItem = (id: string) => {
    setItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((it) => it.id !== id),
    );
  };

  // --- Address selection -> prefill existing fields ---
  const applyAddressToCustomerFields = (addr: InvoiceAddress) => {
    setCustomerName(addr.name || "");
    setPhone(addr.phone || "");
    setEmail(addr.email || "");
    setGstNumber(addr.gstin || "");

    const fullAddress = [
      addr.address_line1,
      addr.address_line2,
      `${addr.city}, ${addr.state} - ${addr.pincode}`,
      addr.country || "India",
    ]
      .filter(Boolean)
      .join("\n");

    setBillingAddress(fullAddress);
  };

  // ✅ Web-generated: scan legacy exact unit code or shared/public scan code
  const groupedSelectedCodes = useMemo(() => {
    const map = new Map<
      string,
      { count: number; isShared: boolean; title: string }
    >();

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
    const requestedQty = Math.max(
      1,
      Math.floor(Number(requestedQtyRaw || 1) || 1),
    );
    if (!enteredCode) return;

    setError(null);
    setScanAvailability("");

    const selectedUnitIds = new Set(scannedUnits.map((u) => u.unit_id));

    if (hasLegacySequenceSuffix(enteredCode)) {
      if (scannedUnits.some((u) => u.unit_code === enteredCode)) {
        setScanAvailability("This exact unit is already selected.");
        return;
      }

      const unitRes = await fetch(
        `/api/vendor/invoice-builder?mode=unit-by-code&code=${encodeURIComponent(enteredCode)}`,
        { cache: "no-store" },
      );
      const unitJson = await unitRes.json().catch(() => ({}));
      if (!unitRes.ok || !unitJson?.ok) throw new Error(unitJson?.error || "Lookup failed");
      const unit = unitJson.data as any;
      if (!unit) {
        setError("Unit not found.");
        return;
      }

      if ((unit.status || "").toUpperCase() !== "IN_STOCK") {
        setError("Unit is not IN_STOCK (already sold/blocked).");
        return;
      }

      // Defense in depth: if a prior invoice flow left an orphan
      // (invoice_units row exists but inventory_units status stuck), reject early
      // instead of failing on the unique-index dup-key.
      const linkRes = await fetch(
        `/api/vendor/invoice-builder?mode=unit-links&unitIds=${encodeURIComponent(unit.id)}`,
        { cache: "no-store" },
      );
      const linkJson = await linkRes.json().catch(() => ({}));
      if ((linkJson?.data || []).length > 0) {
        setError("This unit is already linked to another invoice.");
        return;
      }

      const productMap = await fetchProductsByIds([unit.product_id]);
      const product = productMap.get(unit.product_id);
      if (!product) {
        setError("Product not found for this unit.");
        return;
      }

      const brandName = product?.brands?.name || "";
      const rate = Number(product.compare_at_price ?? product.price ?? 0);

      setScannedUnits((prev) => [
        ...prev,
        {
          unit_id: unit.id,
          unit_code: unit.unit_code,
          scan_code: unit.scan_code || unit.unit_code,
          display_code: getPublicScanCode(unit),
          allocation_mode:
            unit.scan_code && unit.scan_code !== unit.unit_code
              ? "shared_scan"
              : "legacy_exact",
          product_id: product.id,
          product_name: product.name ?? "",
          brand_name: brandName,
          hsn: product.hsn ?? "",
          rate,
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

    // Defense in depth: exclude units already linked to an invoice (orphan state where
    // inventory_units.status update failed after invoice_units insert).
    const candidateIds = (rows || []).map((r: any) => r.id);
    const orphanIds = new Set<string>();
    if (candidateIds.length > 0) {
      const existingRes = await fetch(
        `/api/vendor/invoice-builder?mode=unit-links&unitIds=${encodeURIComponent(candidateIds.join(","))}`,
        { cache: "no-store" },
      );
      const existingJson = await existingRes.json().catch(() => ({}));
      (existingJson?.data || []).forEach((x: any) => orphanIds.add(x.unit_id));
    }

    const allocatable = sortUnitsForAllocation(
      (rows || []).filter(
        (row: any) => !selectedUnitIds.has(row.id) && !orphanIds.has(row.id),
      ),
    );
    const availableCount = allocatable.length;

    if (availableCount === 0) {
      setError("No remaining IN_STOCK quantity for this code.");
      return;
    }

    const picked = allocatable.slice(0, requestedQty);
    const productMap = await fetchProductsByIds(
      picked.map((row: any) => row.product_id),
    );

    const nextUnits: ScannedUnit[] = picked.map((row: any) => {
      const product = productMap.get(row.product_id);
      return {
        unit_id: row.id,
        unit_code: row.unit_code,
        scan_code: row.scan_code || row.unit_code,
        display_code: getPublicScanCode(row),
        allocation_mode: "shared_scan",
        product_id: row.product_id,
        product_name: product?.name ?? "",
        brand_name: product?.brands?.name ?? "",
        hsn: product?.hsn ?? "",
        rate: Number(product?.compare_at_price ?? product?.price ?? 0),
      };
    });

    setScannedUnits((prev) => [...prev, ...nextUnits]);
    setScanAvailability(
      picked.length < requestedQty
        ? `Only ${picked.length} selected. ${availableCount - picked.length} remaining after this add.`
        : `${Math.max(availableCount - picked.length, 0)} remaining after this add.`,
    );
    setScanCode("");
    setScanQty(1);
  }

  function removeUnit(codeToRemove: string) {
    setScannedUnits((prev) => {
      const reversed = [...prev].map((u, index) => ({ u, index })).reverse();

      const match = reversed.find(({ u }) =>
        u.allocation_mode === "shared_scan"
          ? u.display_code === codeToRemove
          : u.unit_code === codeToRemove,
      );

      if (!match) return prev;
      return prev.filter((_, index) => index !== match.index);
    });
  }

  function removeProductLine(productId: string) {
    setScannedUnits((prev) => prev.filter((u) => u.product_id !== productId));
  }

  // Scan add wrapper: surface errors + keep the scan field focused (barcode flow).
  const runScanAdd = async () => {
    try {
      await addUnitByCode(scanCode, scanQty);
    } catch (e: any) {
      const msg = e?.message || "Could not scan that code.";
      setError(msg);
      toast.error(msg);
    } finally {
      scanInputRef.current?.focus();
    }
  };

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

  const extraTotal = useMemo(
    () => extraCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [extraCharges],
  );

  const scannedLines: InvoiceLine[] = useMemo(() => {
    const grouped = new Map<
      string,
      Omit<InvoiceLine, "discountPercent" | "totalDiscount" | "amount">
    >();

    for (const u of scannedUnits) {
      const existing = grouped.get(u.product_id);

      if (!existing) {
        grouped.set(u.product_id, {
          product_id: u.product_id,
          description: u.product_name,
          brand: u.brand_name,
          hsn: u.hsn,
          rate: u.rate,
          qty: 1,
        });
        continue;
      }

      grouped.set(u.product_id, {
        ...existing,
        qty: existing.qty + 1,
      });
    }

    return Array.from(grouped.values()).map((line) => {
      const override = lineOverrides[line.product_id] || {};
      const rate = Number.isFinite(Number(override.rate))
        ? Number(override.rate)
        : line.rate;
      const discountPercent = Number.isFinite(Number(override.discount))
        ? Number(override.discount)
        : 0;
      const computed = calculateLineAmounts({
        quantity: line.qty,
        unitPrice: rate,
        discountPercent,
      });

      return {
        ...line,
        rate,
        discountPercent,
        totalDiscount: computed.totalDiscount,
        amount: computed.lineTotal,
      };
    });
  }, [scannedUnits, lineOverrides]);

  // --- Fetch suggestions per-row (web-generated mode only) ---
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
    const mapped: ProductSuggestion[] = (data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      brand_name: p.brands?.name ?? null,
      hsn: p.hsn ?? null,
      mrp: p.compare_at_price == null ? null : Number(p.compare_at_price),
    }));

    setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: mapped }));
  };

  // --- Totals calculation ---
  const { subtotal, discountTotal, invoiceAmount, taxableAmount } =
    useMemo(() => {
      if (!isCustom) {
        const totals = calculateInvoiceLineTotals([
          ...scannedLines.map((line) => ({
            quantity: line.qty,
            unitPrice: line.rate,
            discountPercent: line.discountPercent,
          })),
          ...extraCharges.map((c) => ({
            quantity: 1,
            unitPrice: Number(c.amount) || 0,
            discountPercent: 0,
          })),
        ]);

        return {
          ...totals,
          taxableAmount: totals.invoiceAmount,
        };
      }

      const totals = calculateInvoiceLineTotals(
        items.map((item) => ({
          quantity: item.quantity,
          unitPrice: item.mrp,
          discountPercent: item.discount,
        })),
      );

      return {
        ...totals,
        taxableAmount: totals.invoiceAmount,
      };
    }, [items, isCustom, scannedLines, extraCharges]);

  // --- Tax calculation (inclusive tax extracted from invoice amount) ---
  const {
    cgstAmount,
    sgstAmount,
    igstAmount,
    taxTotal,
    grandTotal,
    taxableAmount: taxableBaseAmount,
  } = useMemo(() => {
    return calculateInclusiveTaxBreakdown({
      invoiceAmount,
      taxType,
      cgstPercent,
      sgstPercent,
      igstPercent,
    });
  }, [invoiceAmount, taxType, cgstPercent, sgstPercent, igstPercent]);

  // Reset the form for the next invoice (keeps company / tax / notes / dates).
  const resetForNew = () => {
    setScannedUnits([]);
    setLineOverrides({});
    setExtraCharges([]);
    setSelectedAddressId("");
    setCustomerName("");
    setBillingAddress("");
    setPhone("");
    setEmail("");
    setGstNumber("");
    setPanNumber("");
    setInvoiceNumber("");
    setScanCode("");
    setScanAvailability("");
    setError(null);
    setSuccessMessage(null);
    scanInputRef.current?.focus();
  };

  // --- Submit ---
  const handleSave = async (stayOnPage = false) => {
    setError(null);
    setSuccessMessage(null);

    const fail = (m: string) => {
      setError(m);
      toast.error(m);
    };

    if (!companyId) return fail("Please select the invoice company.");
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
      return fail("Add at least one scanned unit or an additional charge.");
    }

    setSaving(true);

    try {
      // Build line items with prices/discounts snapshotted at save time.
      const lineItems = isCustom
        ? items
            .filter((it) => it.description.trim())
            .map((it, index) => {
              const computed = calculateLineAmounts({
                quantity: it.quantity,
                unitPrice: it.mrp,
                discountPercent: it.discount,
              });
              return {
                product_id: it.product_id ?? null,
                brand: it.brand || null,
                description: it.description,
                hsn: it.hsn || null,
                quantity: it.quantity,
                unit_price: it.mrp,
                discount: computed.totalDiscount,
                line_subtotal: computed.lineSubtotal,
                line_total: computed.lineTotal,
                position: index,
              };
            })
        : scannedLines.map((l, index) => {
            const computed = calculateLineAmounts({
              quantity: l.qty,
              unitPrice: l.rate,
              discountPercent: l.discountPercent,
            });
            return {
              product_id: l.product_id,
              brand: l.brand || null,
              description: l.description,
              hsn: l.hsn || null,
              quantity: l.qty,
              unit_price: l.rate,
              discount: computed.totalDiscount,
              line_subtotal: computed.lineSubtotal,
              line_total: computed.lineTotal,
              position: index,
            };
          });

      // Manual additional charges become non-product line items.
      const extraItems = extraCharges
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
            position: lineItems.length + i,
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
          ...(invoiceNumber.trim()
            ? { invoice_number: invoiceNumber.trim() }
            : {}),
          company_id: companyId,
          invoice_date: invoiceDate || null,
          due_date: dueDate || null,
          customer_name: customerName,
          billing_address: billingAddress || null,
          phone: phone || null,
          email: email || null,
          contact_person: null,
          gst_number: gstNumber || null,
          pan_number: panNumber || null,
          subtotal,
          discount_total: discountTotal,
          tax_type: taxType,
          cgst_percent: taxType === "CGST_SGST" ? cgstPercent : 0,
          sgst_percent: taxType === "CGST_SGST" ? sgstPercent : 0,
          igst_percent: taxType === "IGST" ? igstPercent : 0,
          cgst_amount: cgstAmount,
          sgst_amount: sgstAmount,
          igst_amount: igstAmount,
          tax_amount: taxTotal,
          grand_total: grandTotal,
          total_amount: grandTotal,
          notes: notes || null,
          is_custom: isCustom,
          bill_to_address_id: selectedAddressId || null,
        },
        items: allItems,
        units: unitsPayload,
      };

      // Single atomic call: header + items + units + stock status, all-or-nothing.
      const createRes = await fetch("/api/vendor/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createData?.ok)
        throw new Error(createData?.error || "Failed to create invoice");
      const invoiceId = createData.id as string;

      toast.success("Invoice saved successfully.");
      setSuccessMessage("Invoice saved successfully.");

      // Best-effort: auto-email the invoice to the customer if an email exists.
      // Fire-and-forget so it never blocks navigation or fails the save.
      if (email.trim()) {
        (async () => {
          try {
            const res = await fetch(`/api/invoices/${invoiceId}/email`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ type: "invoice" }),
            });
            if (res.ok) toast.success("Invoice emailed to the customer.");
            else
              toast.message(
                "Invoice saved, but the email could not be sent. You can resend it from the invoice page.",
              );
          } catch {
            /* ignore — manual resend available on the invoice page */
          }
        })();
      }

      if (stayOnPage) {
        resetForNew();
      } else {
        // replace (not push) so Back from the saved invoice returns to the list.
        router.replace(`/vendor/invoices/${invoiceId}`);
      }
    } catch (err: any) {
      console.error(err);
      fail(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-6">
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

      {/* Address */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Scan units below to generate invoice items. The manual
            custom-invoice toggle has been removed.
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
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

            <select
              value={selectedAddressId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedAddressId(id);

                const addr = addresses.find((a) => a.id === id);
                if (!addr) return;
                applyAddressToCustomerFields(addr);
              }}
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="">Select saved address</option>
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} — {a.city}
                </option>
              ))}
            </select>

            <p className="text-xs text-muted-foreground">
              Select an address to auto-fill Customer Details and Billing
              Address.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Main form */}
      <Card>
        <CardHeader>
          <CardTitle>Create Invoice</CardTitle>
          <CardDescription>
            Enter an invoice number or leave it blank to auto-generate on save.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="rounded-md border border-green-500 bg-green-50 px-3 py-2 text-sm text-green-700">
              {successMessage}
            </div>
          )}

          {/* Company + basic invoice info */}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <Label>Invoice Company</Label>
              <Select
                disabled={loadingCompanies}
                value={companyId || undefined}
                onValueChange={setCompanyId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs text-slate-700">
                <div className="font-medium">
                  Seller: {selectedCompany?.display_name || "-"}
                </div>
                <div>
                  Support Email:{" "}
                  {selectedCompany?.email || SUPPORT_EMAIL_FALLBACK}
                </div>
                <div>GSTIN: {selectedCompany?.gst_number || "-"}</div>
                <div className="whitespace-pre-line">
                  Address: {selectedCompany?.address || "-"}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Invoice Number</Label>
              <Input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="Leave blank to auto-generate"
              />
            </div>

            <div className="space-y-1">
              <Label>Invoice Date</Label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>Due Date</Label>
              <select
                value={String(paymentTermsDays)}
                onChange={(e) => {
                  const v = e.target.value;
                  setPaymentTermsDays(v === "custom" ? "custom" : Number(v));
                }}
                className="w-full border rounded-md px-2 py-1 text-xs"
              >
                <option value="0">Due on receipt</option>
                <option value="15">Net 15 days</option>
                <option value="30">Net 30 days (credit)</option>
                <option value="45">Net 45 days</option>
                <option value="60">Net 60 days</option>
                <option value="custom">Custom</option>
              </select>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  setPaymentTermsDays("custom");
                }}
              />
            </div>
          </div>

          {/* Customer info */}
          <div className="border-t pt-4">
            <h3 className="mb-2 text-base font-semibold">Customer Details</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Customer Name</Label>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Customer Email (optional)</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Mobile Number</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>GST No (Customer)</Label>
                <Input
                  value={gstNumber}
                  onChange={(e) => setGstNumber(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>PAN Number (Customer)</Label>
                <Input
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <Label>Billing Address</Label>
              <Textarea
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          {/* Scan section */}
          <div className="border-t pt-4 space-y-3">
            <h3 className="text-base font-semibold">Units</h3>

            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium">
                  Scan Unit QR / Unit Code
                </label>
                <input
                  ref={scanInputRef}
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  placeholder="Scan or paste unit code and press Enter"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runScanAdd();
                    }
                  }}
                />
              </div>
              <div className="w-28">
                <label className="text-sm font-medium">Qty</label>
                <Input
                  type="number"
                  min={1}
                  step="1"
                  value={String(scanQty)}
                  onChange={(e) =>
                    setScanQty(Math.max(1, Number(e.target.value) || 1))
                  }
                />
              </div>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={runScanAdd}
              >
                Add
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {groupedSelectedCodes.map((entry) => (
                <span
                  key={entry.code}
                  className="flex max-w-[280px] flex-col gap-0.5 rounded border px-2 py-1 text-xs"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono">
                      {entry.code}
                      {entry.count > 1 ? ` × ${entry.count}` : ""}
                    </span>
                    <button
                      type="button"
                      className="text-red-600"
                      onClick={() => removeUnit(entry.code)}
                      aria-label={`Remove ${entry.code}`}
                    >
                      ×
                    </button>
                  </span>
                  {entry.title && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {entry.title}
                    </span>
                  )}
                </span>
              ))}
            </div>

            {scanAvailability && (
              <p className="text-xs text-muted-foreground">
                {scanAvailability}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Legacy codes still work exactly as before. For new shared codes,
              enter the quantity you want to allocate from the remaining
              in-stock units.
            </p>
          </div>

          {/* Line items */}
          <div className="border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Invoice Items</h3>
              <div className="text-xs text-muted-foreground">
                Items are generated from scanned units
              </div>
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
                    <th className="px-2 py-2 text-right w-[120px]">
                      Discount %
                    </th>
                    <th className="px-2 py-2 text-right w-[160px]">
                      Per Unit After Discount
                    </th>
                    <th className="px-2 py-2 text-right w-[140px]">Amount</th>
                    <th className="px-2 py-2 text-center w-[90px] print:hidden">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {isCustom
                    ? items.map((item, idx) => {
                        const lineComputed = calculateLineAmounts({
                          quantity: item.quantity,
                          unitPrice: item.mrp,
                          discountPercent: item.discount,
                        });
                        const brandLocked = !isCustom && !!item.product_id;
                        const hsnLocked = !isCustom && !!item.product_id;

                        return (
                          <tr key={item.id} className="border-t align-top">
                            <td className="px-2 py-2">{idx + 1}</td>

                            <td className="px-2 py-2">
                              <Input
                                value={item.brand}
                                onChange={(e) =>
                                  updateItem(item.id, { brand: e.target.value })
                                }
                                placeholder="Brand"
                                disabled={brandLocked}
                              />
                            </td>

                            <td className="px-2 py-2 relative">
                              <Input
                                value={item.description}
                                onFocus={() =>
                                  !isCustom &&
                                  setActiveSuggestForItemId(item.id)
                                }
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveSuggestForItemId((prev) =>
                                      prev === item.id ? null : prev,
                                    );
                                    setProductSuggestionsByItem((prev) => ({
                                      ...prev,
                                      [item.id]: [],
                                    }));
                                  }, 150);
                                }}
                                onChange={(e) => {
                                  const v = e.target.value;

                                  if (isCustom) {
                                    updateItem(item.id, { description: v });
                                    return;
                                  }

                                  updateItem(item.id, {
                                    description: v,
                                    product_id: null,
                                    brand: "",
                                    hsn: "",
                                  });

                                  setActiveSuggestForItemId(item.id);
                                  fetchProductSuggestions(item.id, v);
                                }}
                                placeholder={
                                  isCustom
                                    ? "Product name"
                                    : "Search website product..."
                                }
                              />

                              {!isCustom &&
                                activeSuggestForItemId === item.id &&
                                (productSuggestionsByItem[item.id]?.length ||
                                  0) > 0 && (
                                  <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-sm max-h-60 overflow-auto">
                                    {productSuggestionsByItem[item.id].map(
                                      (p: any) => (
                                        <button
                                          key={p.id}
                                          type="button"
                                          className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-3"
                                          onMouseDown={(ev) =>
                                            ev.preventDefault()
                                          }
                                          onClick={() => {
                                            updateItem(item.id, {
                                              description: p.name,
                                              product_id: p.id,
                                              brand: p.brand_name ?? "",
                                              hsn: p.hsn ?? "",
                                              mrp: p.mrp ?? 0,
                                            });

                                            setProductSuggestionsByItem(
                                              (prev) => ({
                                                ...prev,
                                                [item.id]: [],
                                              }),
                                            );
                                            setActiveSuggestForItemId(null);
                                          }}
                                        >
                                          <span className="truncate">
                                            {p.name}
                                          </span>
                                          <span className="text-xs text-slate-600">
                                            {p.mrp != null ? fmtINR(p.mrp) : ""}
                                          </span>
                                        </button>
                                      ),
                                    )}
                                  </div>
                                )}

                              {!isCustom &&
                                item.description.trim() &&
                                !item.product_id && (
                                  <div className="mt-1 text-xs text-amber-600">
                                    Select from suggestions
                                  </div>
                                )}
                            </td>

                            <td className="px-2 py-2">
                              <Input
                                value={item.hsn}
                                onChange={(e) =>
                                  updateItem(item.id, { hsn: e.target.value })
                                }
                                placeholder="HSN"
                                disabled={hsnLocked}
                              />
                            </td>

                            <td className="px-2 py-2">
                              <Input
                                type="number"
                                min={0}
                                value={item.quantity.toString()}
                                onChange={(e) =>
                                  updateItem(item.id, {
                                    quantity: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </td>

                            <td className="px-2 py-2">
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={item.mrp.toString()}
                                onChange={(e) =>
                                  updateItem(item.id, {
                                    mrp: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </td>

                            <td className="px-2 py-2">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={item.discount.toString()}
                                onChange={(e) =>
                                  updateItem(item.id, {
                                    discount: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </td>

                            <td className="px-2 py-2 text-right font-medium">
                              {fmtINR(
                                lineComputed.unitPrice -
                                  lineComputed.discountPerUnitAmount,
                              )}
                            </td>

                            <td className="px-2 py-2 text-right font-medium">
                              {fmtINR(lineComputed.lineTotal)}
                            </td>

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
                    : scannedLines.length === 0 ? (
                        <tr>
                          <td
                            colSpan={10}
                            className="px-3 py-8 text-center text-sm text-muted-foreground"
                          >
                            Scan a unit code above to add invoice items.
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
                            <Input value={l.hsn} disabled />
                          </td>

                          <td className="px-2 py-2">
                            <Input value={String(l.qty)} disabled />
                          </td>

                          {/* ✅ MRP editable */}
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(l.rate)}
                              onChange={(e) =>
                                setLineRate(
                                  l.product_id,
                                  Number(e.target.value) || 0,
                                )
                              }
                            />
                          </td>

                          {/* ✅ Discount editable */}
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={String(
                                Number(
                                  lineOverrides[l.product_id]?.discount ??
                                    l.discountPercent ??
                                    0,
                                ),
                              )}
                              onChange={(e) =>
                                setLineDiscount(
                                  l.product_id,
                                  Number(e.target.value) || 0,
                                )
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
                                  round2(
                                    l.rate -
                                      (l.rate *
                                        (Number(
                                          lineOverrides[l.product_id]?.discount ??
                                            l.discountPercent ??
                                            0,
                                        ) || 0)) /
                                        100,
                                  ),
                                )
                              }
                              onChange={(e) =>
                                setNetDraft((prev) => ({
                                  ...prev,
                                  [l.product_id]: e.target.value,
                                }))
                              }
                              onBlur={() => commitNetPrice(l.product_id, l.rate)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  (e.target as HTMLInputElement).blur();
                              }}
                            />
                          </td>

                          <td className="px-2 py-2 text-right font-medium">
                            {fmtINR(l.amount)}
                          </td>

                          <td className="px-2 py-2 text-center print:hidden">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeProductLine(l.product_id)}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))
                      )}
                </tbody>
              </table>
            </div>

            {/* Additional charges */}
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

            {/* Totals */}
            <div className="mt-4 flex flex-col items-end space-y-1 text-sm">
              <div className="flex w-full max-w-sm justify-between">
                <span>Subtotal</span>
                <span>{fmtINR(subtotal)}</span>
              </div>

              <div className="flex w-full max-w-sm justify-between">
                <span>Discount</span>
                <span>{fmtINR(discountTotal)}</span>
              </div>

              <div className="flex w-full max-w-sm justify-between">
                <span className="text-muted-foreground">Taxable Amount</span>
                <span className="font-medium">{fmtINR(taxableBaseAmount)}</span>
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

              {taxType === "CGST_SGST" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">
                      CGST %
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={cgstPercent.toString()}
                      onChange={(e) =>
                        setCgstPercent(Number(e.target.value) || 0)
                      }
                    />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">
                      SGST %
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={sgstPercent.toString()}
                      onChange={(e) =>
                        setSgstPercent(Number(e.target.value) || 0)
                      }
                    />
                  </div>
                </div>
              )}

              {taxType === "IGST" && (
                <div className="mt-2">
                  <div className="text-xs text-muted-foreground mb-1">
                    IGST %
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={igstPercent.toString()}
                    onChange={(e) =>
                      setIgstPercent(Number(e.target.value) || 0)
                    }
                  />
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="border-t pt-4">
            <div className="space-y-1">
              <Label>Notes / Internal Reference</Label>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Sticky action bar — always-visible totals + save */}
      <div className="sticky bottom-4 z-20 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-lg font-bold">{fmtINR(grandTotal)}</span>
            <span className="ml-2 text-muted-foreground">
              {scannedLines.length + extraCharges.length} item
              {scannedLines.length + extraCharges.length === 1 ? "" : "s"} ·{" "}
              {scannedUnits.length} unit{scannedUnits.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => window.print()}
            >
              Print
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving || !isAdmin}
              title={isViewer ? "View-only access" : undefined}
              onClick={() => handleSave(true)}
            >
              {saving ? "Saving…" : "Save & New"}
            </Button>
            <Button
              type="button"
              disabled={saving || !isAdmin}
              title={isViewer ? "View-only access" : undefined}
              onClick={() => handleSave(false)}
            >
              {saving ? "Saving…" : "Save Invoice"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
