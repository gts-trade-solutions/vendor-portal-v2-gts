// components/addresses/QuickAddAddressDialog.tsx
"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

export type InvoiceAddress = {
  id: string;
  vendor_id: string;
  label: string;
  category: string | null;
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

type FormValues = {
  label: string;
  category: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
};

// Customer categories shown in Quick Add.
const CUSTOMER_CATEGORIES = [
  "Individual",
  "Retailer",
  "Salon",
  "Spa",
  "Clinic",
  "Dermatologist",
  "Distributor",
  "Corporate",
  "Other",
];

const DEFAULT_VALUES: FormValues = {
  label: "",
  category: "",
  name: "",
  phone: "",
  email: "",
  gstin: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  pincode: "",
  country: "India",
};

export function QuickAddAddressDialog({
  onCreated,
  triggerText = "Add New Address",
}: {
  onCreated: (created: InvoiceAddress) => void;
  triggerText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<FormValues>(DEFAULT_VALUES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = useMemo(() => {
    return (
      v.label.trim() &&
      v.address_line1.trim() &&
      v.city.trim() &&
      v.state.trim() &&
      v.pincode.trim()
    );
  }, [v]);

  const set = (k: keyof FormValues, val: string) => {
    setV((p) => ({ ...p, [k]: val }));
  };

  const reset = () => {
    setV(DEFAULT_VALUES);
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    if (!canSave) {
      setError("Please fill: Label, Address line 1, City, State, Pincode.");
      return;
    }

    setSaving(true);

    try {
      // owner (vendor_id) is stamped server-side from the NextAuth session.
      const fields = {
        label: v.label.trim(),
        category: v.category || null,
        name: v.name || null,
        phone: v.phone || null,
        email: v.email || null,
        gstin: v.gstin || null,
        address_line1: v.address_line1.trim(),
        address_line2: v.address_line2 || null,
        city: v.city.trim(),
        state: v.state.trim(),
        pincode: v.pincode.trim(),
        country: (v.country || "India").trim(),
      };

      const res = await fetch("/api/vendor/invoice-addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || !json?.id)
        throw new Error(json?.error || "Failed to save address");

      onCreated({ id: json.id, ...fields } as InvoiceAddress);
      setOpen(false);
      reset();
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {triggerText}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add New Bill-To Address</DialogTitle>
          <DialogDescription>
            Save once and reuse in invoices. After saving, it will be auto-selected.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Label *</Label>
            <Input value={v.label} onChange={(e) => set("label", e.target.value)} placeholder="Home / Shop / Office" />
          </div>

          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Customer / Company Name" />
          </div>

          <div className="space-y-1">
            <Label>Customer Category</Label>
            <select
              value={v.category}
              onChange={(e) => set("category", e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">Select category (optional)</option>
              {CUSTOMER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Phone</Label>
            <Input value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Mobile number" />
          </div>

          <div className="space-y-1">
            <Label>Email</Label>
            <Input value={v.email} onChange={(e) => set("email", e.target.value)} placeholder="Email (optional)" />
          </div>

          <div className="space-y-1">
            <Label>GSTIN</Label>
            <Input value={v.gstin} onChange={(e) => set("gstin", e.target.value)} placeholder="GSTIN (optional)" />
          </div>

          <div className="space-y-1">
            <Label>Country</Label>
            <Input value={v.country} onChange={(e) => set("country", e.target.value)} placeholder="India" />
          </div>

          <div className="space-y-1">
            <Label>City *</Label>
            <Input value={v.city} onChange={(e) => set("city", e.target.value)} placeholder="City" />
          </div>

          <div className="space-y-1">
            <Label>State *</Label>
            <Input value={v.state} onChange={(e) => set("state", e.target.value)} placeholder="State" />
          </div>

          <div className="space-y-1">
            <Label>Pincode *</Label>
            <Input value={v.pincode} onChange={(e) => set("pincode", e.target.value)} placeholder="Pincode" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Address Line 1 *</Label>
            <Textarea rows={3} value={v.address_line1} onChange={(e) => set("address_line1", e.target.value)} placeholder="Street / Building / Area" />
          </div>

          <div className="space-y-1">
            <Label>Address Line 2</Label>
            <Textarea rows={3} value={v.address_line2} onChange={(e) => set("address_line2", e.target.value)} placeholder="Landmark / Additional details" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? "Saving..." : "Save Address"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
