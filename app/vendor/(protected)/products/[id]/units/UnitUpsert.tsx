"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InventoryStatus =
  | "IN_STOCK"
  | "INVOICED"
  | "DEMO"
  | "SOLD"
  | "RETURNED"
  | "OUT_OF_STOCK";

const MAX_BATCH_UNITS = 100;
const MAX_SUFFIX = 999;

function toYmd(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function addYears(date: Date, years: number) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

function ymdToCompact(ymd: string) {
  return (ymd || "").replaceAll("-", "");
}

function priceToCodePart(price: number) {
  if (!Number.isFinite(price)) return "";
  return String(Math.round(price * 100)); // 2 decimals
}

function first2Letters(name: string) {
  const letters = (name || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 2) || "XX").padEnd(2, "X");
}

function rand4() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

function clampInt(v: any, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

async function getNextSequenceStart(args: {
  productId: string;
  batchBaseCode: string;
}) {
  const { productId, batchBaseCode } = args;

  // Vendor-scoped, server-side sequence preview. The create endpoint is the
  // authority on the actual suffix used; this only drives the live preview.
  const res = await fetch(
    `/api/vendor/inventory-units?mode=next-seq&productId=${encodeURIComponent(
      productId,
    )}&base=${encodeURIComponent(batchBaseCode)}`,
    { cache: "no-store" },
  );
  const body = await res.json();
  if (!res.ok || !body?.ok) throw new Error(body?.error || "Failed to read sequence");
  return Number(body.next ?? 1);
}

export function UnitUpsertDialog({
  open,
  onOpenChange,
  mode,
  vendorId,
  productId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  vendorId: string;
  productId: string;
  initial?: {
    id: string;
    unit_code: string;
    manufacture_date?: string | null;
    expiry_date?: string | null;
    status: InventoryStatus;
  } | null;
  onSaved: () => void;
}) {
  const isEdit = mode === "edit";
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);

  // meta fetched (create)
  const [productName, setProductName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [brandCode, setBrandCode] = useState("");

  // form fields
  const [unitCode, setUnitCode] = useState("");
  const [manufactureDate, setManufactureDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [editStatus, setEditStatus] = useState<InventoryStatus>("IN_STOCK");

  // internal price (NOT editable) – used for unit_code generation + insert
  const [salePrice, setSalePrice] = useState<number>(0);

  // batch count (create)
  const [unitsCount, setUnitsCount] = useState<number>(1);

  // next sequence (create)
  const [nextSeqStart, setNextSeqStart] = useState<number>(1);
  const [loadingSeq, setLoadingSeq] = useState(false);

  // Load on open
  useEffect(() => {
    if (!open) return;

    // EDIT MODE
    if (isEdit && initial) {
      setUnitCode(initial.unit_code ?? "");
      setManufactureDate((initial.manufacture_date ?? "") as string);
      setExpiryDate((initial.expiry_date ?? "") as string);
      setEditStatus(initial.status ?? "IN_STOCK");
      setUnitsCount(1);
      return;
    }

    // CREATE MODE
    (async () => {
      setLoadingMeta(true);
      try {
        const today = new Date();
        setManufactureDate(toYmd(addYears(today, -1)));
        setExpiryDate(toYmd(addYears(today, 2)));
        setUnitsCount(1);

        // product (vendor-scoped server endpoint)
        const pRes = await fetch(
          `/api/vendor/products?mode=single&id=${encodeURIComponent(productId)}`,
          { cache: "no-store" },
        );
        const pBody = await pRes.json();
        if (!pRes.ok || !pBody?.ok) throw new Error(pBody?.error || "Failed to load product");
        const p = pBody.data;

        const pName = (p as any)?.name ?? "";
        setProductName(pName);

        const pCode =
          (p as any)?.product_code?.toString()?.trim() ||
          `${first2Letters(pName)}${rand4()}`;
        setProductCode(pCode);

        const sp = (p as any)?.price;
        const final = sp != null ? Number(sp) : 0;
        setSalePrice(Number.isFinite(final) ? final : 0);

        // brand (shared catalog, auth-gated endpoint)
        const brandId = (p as any)?.brand_id;
        if (brandId) {
          const bRes = await fetch(
            `/api/vendor/brands?id=${encodeURIComponent(brandId)}`,
            { cache: "no-store" },
          );
          const bBody = await bRes.json();
          if (!bRes.ok || !bBody?.ok) throw new Error(bBody?.error || "Failed to load brand");
          const b = bBody.data;

          const bName = (b as any)?.name ?? "";
          setBrandName(bName);

          const bCode =
            (b as any)?.brand_code?.toString()?.trim() ||
            `${first2Letters(bName)}${rand4()}`;
          setBrandCode(bCode);
        } else {
          setBrandName("");
          setBrandCode("XX" + rand4());
        }
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || "Failed to load product/brand data");
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, [open, isEdit, initial, productId]);

  // base code for create (batch)
  const batchBaseCode = useMemo(() => {
    if (!productCode || !brandCode || !manufactureDate || !expiryDate)
      return "";
    const mfg = ymdToCompact(manufactureDate);
    const exp = ymdToCompact(expiryDate);
    const pr = priceToCodePart(salePrice);
    return `${productCode}${brandCode}${mfg}${exp}${pr}`;
  }, [productCode, brandCode, manufactureDate, expiryDate, salePrice]);

  // compute next sequence start whenever base changes (create mode only)
  useEffect(() => {
    if (!open || isEdit) return;
    if (!vendorId || !productId || !batchBaseCode) {
      setNextSeqStart(1);
      return;
    }

    let alive = true;
    (async () => {
      setLoadingSeq(true);
      try {
        const next = await getNextSequenceStart({
          productId,
          batchBaseCode,
        });
        if (alive) setNextSeqStart(next);
      } catch (e: any) {
        console.error(e);
        if (alive) setNextSeqStart(1);
        toast.error(e?.message || "Failed to check existing batch numbers");
      } finally {
        if (alive) setLoadingSeq(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, isEdit, vendorId, productId, batchBaseCode]);

  const previewCodes = useMemo(() => {
    if (!batchBaseCode) return [];
    const count = clampInt(unitsCount || 1, 1, MAX_BATCH_UNITS);
    const n = Math.min(count, 3);
    const start = Math.max(1, nextSeqStart || 1);
    return Array.from({ length: n }).map(
      (_, i) => `${batchBaseCode}-${pad3(start + i)}`
    );
  }, [batchBaseCode, unitsCount, nextSeqStart]);

  // Create batch
  // U2 starts creating new batches with a shared/public scan_code while
  // keeping the internal unit_code unique with the legacy numeric suffix.
  const createBatch = async () => {
    if (!vendorId || !productId) return;

    const count = clampInt(unitsCount || 1, 1, MAX_BATCH_UNITS);

    if (!batchBaseCode)
      return toast.error("Unit code not ready. Please check dates/codes.");
    if (!manufactureDate) return toast.error("Manufacture date is required.");
    if (!expiryDate) return toast.error("Expiry date is required.");

    setSaving(true);
    try {
      // The server endpoint owns the sequence + insert atomically (vendor-scoped),
      // so the client no longer computes the start or retries duplicates.
      const res = await fetch("/api/vendor/inventory-units/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          productId,
          batchBaseCode,
          count,
          manufactureDate,
          expiryDate,
          price: salePrice,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || "Failed to create units");
      }

      toast.success(`Created ${body.created ?? count} unit(s) for ${batchBaseCode}`);
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to create units");
    } finally {
      setSaving(false);
    }
  };

  // Save edit (single)
  const saveEdit = async () => {
    if (!initial?.id) return;

    const nextUnitCode = unitCode.trim();

    if (!nextUnitCode) return toast.error("Unit code is required.");
    if (!manufactureDate) return toast.error("Manufacture date is required.");

    setSaving(true);
    try {
      // Optional friendly duplicate check (vendor-scoped, server-side).
      if (nextUnitCode !== initial.unit_code) {
        const dupRes = await fetch(
          `/api/vendor/inventory-units?mode=dup-check&code=${encodeURIComponent(
            nextUnitCode,
          )}&exceptId=${encodeURIComponent(initial.id)}`,
          { cache: "no-store" },
        );
        const dupBody = await dupRes.json();
        if (dupRes.ok && dupBody?.ok && dupBody.exists) {
          toast.error(
            "This unit code already exists. Please use a unique unit code."
          );
          return;
        }
      }

      // Note: unit_code is read-only in edit mode, so only dates/status change.
      const res = await fetch("/api/vendor/inventory-units/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          ids: [initial.id],
          patch: {
            manufacture_date: manufactureDate,
            expiry_date: expiryDate || null,
            status: editStatus,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || "Update failed");

      toast.success("Unit updated");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Unit" : "Create Unit Batch"}
          </DialogTitle>
        </DialogHeader>

        {isEdit ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-1">Unit code</div>
              <Input value={unitCode} readOnly disabled />
              <div className="text-xs text-muted-foreground mt-1">
                Unit code cannot be edited after creation.
              </div>

              <div className="text-xs text-muted-foreground mt-1">
                Must be unique per vendor.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Manufacture Date</div>
                <Input
                  type="date"
                  value={manufactureDate}
                  onChange={(e) => setManufactureDate(e.target.value)}
                />
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Expiry Date</div>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Status</div>
              <Select
                value={editStatus}
                onValueChange={(v) => setEditStatus(v as InventoryStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  <SelectItem value="IN_STOCK">IN_STOCK</SelectItem>
                  <SelectItem value="INVOICED">INVOICED</SelectItem>
                  <SelectItem value="DEMO">DEMO</SelectItem>
                  <SelectItem value="SOLD">SOLD</SelectItem>
                  <SelectItem value="RETURNED">RETURNED</SelectItem>

                  {/* If you want to hide OUT_OF_STOCK everywhere on this page, keep it removed */}
                  {/* <SelectItem value="OUT_OF_STOCK">OUT_OF_STOCK</SelectItem> */}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">
                  Product Code (auto)
                </div>
                <Input value={productCode} readOnly placeholder="Loading…" />
                {productName ? (
                  <div className="text-xs text-muted-foreground mt-1">
                    {productName}
                  </div>
                ) : null}
              </div>
              <div>
                <div className="text-sm font-medium mb-1">
                  Brand Code (auto)
                </div>
                <Input value={brandCode} readOnly placeholder="Loading…" />
                {brandName ? (
                  <div className="text-xs text-muted-foreground mt-1">
                    {brandName}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Manufacture Date</div>
                <Input
                  type="date"
                  value={manufactureDate}
                  onChange={(e) => setManufactureDate(e.target.value)}
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Default: today - 1 year
                </div>
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Expiry Date</div>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Default: today + 2 years
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Sale price (auto)</div>
              <Input
                value={Number.isFinite(salePrice) ? String(salePrice) : "0"}
                readOnly
              />
              <div className="text-xs text-muted-foreground mt-1">
                Used to generate code + saved into inventory_units.price
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">
                  Units count (batch)
                </div>
                <Input
                  type="number"
                  value={unitsCount}
                  min={1}
                  max={MAX_BATCH_UNITS}
                  onChange={(e) =>
                    setUnitsCount(clampInt(e.target.value, 1, MAX_BATCH_UNITS))
                  }
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Max {MAX_BATCH_UNITS} per batch.
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">
                  Public Scan Code (auto)
                </div>
                <Input
                  value={batchBaseCode}
                  readOnly
                  placeholder="Auto-generated"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  This is the shared code you can print/scan for the new flow.
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Shared scan code preview</div>

              <div className="rounded-md border p-3 text-sm font-mono">
                {batchBaseCode ? (
                  <div className="space-y-1">
                    <div>{batchBaseCode}</div>
                    <div className="text-xs font-sans text-muted-foreground">
                      {Math.min(Math.max(Math.floor(unitsCount || 1), 1), 100)} unit(s) will be created with this same public scan code.
                    </div>
                    <div className="text-xs font-sans text-muted-foreground">
                      Internal unique unit IDs are still created automatically in the background.
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground">Loading…</div>
                )}
              </div>

              {/* <div className="text-xs text-muted-foreground mt-1">
    Continues numbering automatically (e.g., -050 then next is -051).
  </div> */}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          {isEdit ? (
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : (
            <Button
              onClick={createBatch}
              disabled={saving || loadingMeta || !batchBaseCode}
            >
              {saving ? "Creating…" : "Create units"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
