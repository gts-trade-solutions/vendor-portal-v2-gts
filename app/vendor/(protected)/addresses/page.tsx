// app/vendor/(protected)/addresses/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export default function AddressesListPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<InvoiceAddress[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/vendor/invoice-addresses", {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Not logged in.");
          setRows([]);
        } else if (!res.ok || !json?.ok) {
          console.error(json?.error);
          setError(json?.error || "Failed to load addresses");
          setRows([]);
        } else {
          setRows((json.data || []) as InvoiceAddress[]);
        }
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "Failed to load addresses");
        setRows([]);
      }

      setLoading(false);
    };

    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((a) => {
      const hay = [
        a.label,
        a.name || "",
        a.phone || "",
        a.email || "",
        a.gstin || "",
        a.address_line1,
        a.address_line2 || "",
        a.city,
        a.state,
        a.pincode,
        a.country,
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [rows, search]);

  const handleDelete = async (id: string) => {
    const ok = window.confirm("Delete this address?");
    if (!ok) return;

    setDeletingId(id);
    setError(null);

    try {
      const res = await fetch(
        `/api/vendor/invoice-addresses?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to delete address");
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to delete address");
    }

    setDeletingId(null);
  };

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Saved Bill-To Addresses</CardTitle>
            <CardDescription>
              Create addresses once and reuse them while creating invoices.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push("/vendor/invoices/new")}>
              ← Back to Invoice
            </Button>
            <Button onClick={() => router.push("/vendor/addresses/new")}>
              + Add Address
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="w-full max-w-sm">
              <Input
                placeholder="Search address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading && <div className="text-sm text-slate-600">Loading addresses...</div>}

          {!loading && filtered.length === 0 && (
            <div className="text-sm text-slate-500">No addresses found.</div>
          )}

          {filtered.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Label</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Phone</th>
                    <th className="px-3 py-2 text-left">City</th>
                    <th className="px-3 py-2 text-left">State</th>
                    <th className="px-3 py-2 text-left">Pincode</th>
                    <th className="px-3 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="px-3 py-2 font-medium">{a.label}</td>
                      <td className="px-3 py-2">{a.name || "-"}</td>
                      <td className="px-3 py-2">{a.phone || "-"}</td>
                      <td className="px-3 py-2">{a.city}</td>
                      <td className="px-3 py-2">{a.state}</td>
                      <td className="px-3 py-2">{a.pincode}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/vendor/addresses/${a.id}/edit`)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deletingId === a.id}
                            onClick={() => handleDelete(a.id)}
                          >
                            {deletingId === a.id ? "Deleting..." : "Delete"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
