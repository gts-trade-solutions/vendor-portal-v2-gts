"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  InventoryStatus,
  INVENTORY_STATUSES,
  statusLabel,
} from "@/components/inventory/UnitStatusBadge";
import { ScanBox } from "@/components/inventory/ScanBox";

type UnitRow = {
  id: string;
  unit_code: string;
  mfg_date: string | null;
  exp_date: string | null;
  status: InventoryStatus;
  created_at: string;
};

function isValidCode(code: string) {
  return code.trim().length > 0;
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
  initial?: UnitRow | null;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"manual" | "scan">("manual");

  const [unitCode, setUnitCode] = useState("");
  const [mfgDate, setMfgDate] = useState("");
  const [expDate, setExpDate] = useState("");
  const [status, setStatus] = useState<InventoryStatus>("IN_STOCK");
  const [busy, setBusy] = useState(false);

  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;

    if (isEdit && initial) {
      setTab("manual");
      setUnitCode(initial.unit_code ?? "");
      setMfgDate(initial.mfg_date ?? "");
      setExpDate(initial.exp_date ?? "");
      setStatus(initial.status ?? "IN_STOCK");
    } else {
      setTab("scan"); // default scanner mode is faster for warehouses
      setUnitCode("");
      setMfgDate("");
      setExpDate("");
      setStatus("IN_STOCK");
    }
  }, [open, isEdit, initial]);

  const canSave = useMemo(() => {
    if (!isValidCode(unitCode)) return false;
    if (mfgDate && expDate && mfgDate > expDate) return false;
    return true;
  }, [unitCode, mfgDate, expDate]);

  // Vendor-scoped duplicate check via the server endpoint.
  const codeExists = async (code: string, exceptId?: string) => {
    const trimmed = code.trim();
    if (!trimmed) return false;
    const res = await fetch(
      `/api/vendor/inventory-units?mode=dup-check&code=${encodeURIComponent(
        trimmed,
      )}${exceptId ? `&exceptId=${encodeURIComponent(exceptId)}` : ""}`,
      { cache: "no-store" },
    );
    const body = await res.json();
    if (!res.ok || !body?.ok) throw new Error(body?.error || "Check failed");
    return !!body.exists;
  };

  const ensureUniqueUnitCode = async (code: string) => {
    // dup-check already excludes the edited row when exceptId is passed.
    const exists = await codeExists(code, isEdit ? initial?.id : undefined);
    return !exists;
  };

  const onScan = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    // Fill the unit_code from scan
    setUnitCode(trimmed);

    // Optional: quick check if already exists -> warn
    try {
      if (!isEdit && (await codeExists(trimmed))) {
        toast.warning("This QR code already exists in inventory.");
      }
    } catch (e) {
      console.warn(e);
    }
  };

  const save = async () => {
    const code = unitCode.trim();
    if (!isValidCode(code)) {
      toast.error("Unit code is required.");
      return;
    }
    if (mfgDate && expDate && mfgDate > expDate) {
      toast.error("MFG date cannot be after EXP date.");
      return;
    }

    setBusy(true);
    try {
      const ok = await ensureUniqueUnitCode(code);
      if (!ok) {
        toast.error("Unit code already exists. Use a different code.");
        setBusy(false);
        return;
      }

      if (!isEdit) {
        const res = await fetch("/api/vendor/inventory-units/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            mode: "single",
            productId,
            unitCode: code,
            manufactureDate: mfgDate || null,
            expiryDate: expDate || null,
          }),
        });
        const body = await res.json();
        if (!res.ok || !body?.ok) throw new Error(body?.error || "Failed to add unit");
        toast.success("Unit added");
      } else {
        if (!initial?.id) throw new Error("Missing unit id to edit");

        const res = await fetch("/api/vendor/inventory-units/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            ids: [initial.id],
            patch: {
              unit_code: code,
              mfg_date: mfgDate || null,
              exp_date: expDate || null,
              status,
            },
          }),
        });
        const body = await res.json();
        if (!res.ok || !body?.ok) throw new Error(body?.error || "Update failed");
        toast.success("Unit updated");
      }

      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save unit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit unit" : "Add unit"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update unit_code, dates, and status."
              : "Create a unit by scanning a QR (unit_code) or typing manually."}
          </DialogDescription>
        </DialogHeader>

        {!isEdit ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scan">QR Scanner</TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>

            <TabsContent value="scan" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Scan unit QR</Label>
                <ScanBox onScan={onScan} />
                <p className="text-xs text-muted-foreground">
                  Tip: QR should contain only the unit_code (example: MK-SS-00001)
                </p>
              </div>

              <div className="space-y-2">
                <Label>Unit code</Label>
                <Input
                  value={unitCode}
                  onChange={(e) => setUnitCode(e.target.value)}
                  placeholder="Scanned code appears here"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>MFG date</Label>
                  <Input
                    type="date"
                    value={mfgDate}
                    onChange={(e) => setMfgDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>EXP date</Label>
                  <Input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Unit code</Label>
                <Input
                  value={unitCode}
                  onChange={(e) => setUnitCode(e.target.value)}
                  placeholder="Enter unit_code (printed inside QR)"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>MFG date</Label>
                  <Input
                    type="date"
                    value={mfgDate}
                    onChange={(e) => setMfgDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>EXP date</Label>
                  <Input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Unit code</Label>
              <Input
                value={unitCode}
                onChange={(e) => setUnitCode(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>MFG date</Label>
                <Input
                  type="date"
                  value={mfgDate}
                  onChange={(e) => setMfgDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>EXP date</Label>
                <Input
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {INVENTORY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave || busy} onClick={save}>
            {busy ? "Saving..." : isEdit ? "Save changes" : "Add unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
