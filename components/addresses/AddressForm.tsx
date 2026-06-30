// components/addresses/AddressForm.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type AddressFormValues = {
  label: string;
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

export function AddressForm({
  initialValues,
  onSubmit,
  submitting,
  submitText,
}: {
  initialValues: AddressFormValues;
  onSubmit: (values: AddressFormValues) => Promise<void>;
  submitting: boolean;
  submitText: string;
}) {
  const [v, setV] = useState<AddressFormValues>(initialValues);

  const set = (k: keyof AddressFormValues, val: string) => {
    setV((p) => ({ ...p, [k]: val }));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Label</Label>
          <Input value={v.label} onChange={(e) => set("label", e.target.value)} placeholder="e.g. Home / Shop / Office" />
        </div>

        <div className="space-y-1">
          <Label>Name</Label>
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Customer / Company Name" />
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
          <Label>City</Label>
          <Input value={v.city} onChange={(e) => set("city", e.target.value)} placeholder="City" />
        </div>

        <div className="space-y-1">
          <Label>State</Label>
          <Input value={v.state} onChange={(e) => set("state", e.target.value)} placeholder="State" />
        </div>

        <div className="space-y-1">
          <Label>Pincode</Label>
          <Input value={v.pincode} onChange={(e) => set("pincode", e.target.value)} placeholder="Pincode" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Address Line 1</Label>
          <Textarea rows={3} value={v.address_line1} onChange={(e) => set("address_line1", e.target.value)} placeholder="Street / Building / Area" />
        </div>
        <div className="space-y-1">
          <Label>Address Line 2</Label>
          <Textarea rows={3} value={v.address_line2} onChange={(e) => set("address_line2", e.target.value)} placeholder="Landmark / Additional details (optional)" />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={submitting}
          onClick={() => onSubmit(v)}
        >
          {submitting ? "Saving..." : submitText}
        </Button>
      </div>
    </div>
  );
}
