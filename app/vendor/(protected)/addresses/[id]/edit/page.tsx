// app/vendor/(protected)/addresses/[id]/edit/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { AddressForm, AddressFormValues } from "@/components/addresses/AddressForm";

export default function EditAddressPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [initialValues, setInitialValues] = useState<AddressFormValues | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!id) return;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/vendor/invoice-addresses?id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        const json = await res.json().catch(() => ({}));
        const data = json?.data;

        if (!res.ok || !json?.ok || !data) {
          setError(json?.error || "Address not found");
          setInitialValues(null);
        } else {
          setInitialValues({
            label: data.label || "",
            name: data.name || "",
            phone: data.phone || "",
            email: data.email || "",
            gstin: data.gstin || "",
            address_line1: data.address_line1 || "",
            address_line2: data.address_line2 || "",
            city: data.city || "",
            state: data.state || "",
            pincode: data.pincode || "",
            country: data.country || "India",
          });
        }
      } catch (e: any) {
        setError(e?.message || "Address not found");
        setInitialValues(null);
      }

      setLoading(false);
    };

    load();
  }, [id]);

  const onSubmit = async (v: AddressFormValues) => {
    setError(null);

    if (!v.label.trim()) return setError("Label is required.");
    if (!v.address_line1.trim()) return setError("Address line 1 is required.");
    if (!v.city.trim()) return setError("City is required.");
    if (!v.state.trim()) return setError("State is required.");
    if (!v.pincode.trim()) return setError("Pincode is required.");

    setSaving(true);

    try {
      const res = await fetch(
        `/api/vendor/invoice-addresses?id=${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: v.label.trim(),
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
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Not logged in.");
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to update address");

      router.push("/vendor/addresses");
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl py-6 space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Edit Address</CardTitle>
            <CardDescription>
              Update this bill-to address.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => router.push("/vendor/addresses")}>
            ← Back
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading && <div className="text-sm text-slate-600">Loading...</div>}

          {!loading && initialValues && (
            <AddressForm
              initialValues={initialValues}
              onSubmit={onSubmit}
              submitting={saving}
              submitText="Save Changes"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
