"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  Building2,
  Landmark,
  Plus,
  Pencil,
  Trash2,
  ShieldAlert,
  Inbox,
} from "lucide-react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
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
} from "@/components/ui/dialog";

type Company = {
  id: string;
  key: string;
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
  upi_vpa: string | null;
  created_at?: string;
};

type FormValues = {
  display_name: string;
  legal_name: string;
  key: string;
  gst_number: string;
  pan_number: string;
  phone: string;
  email: string;
  address: string;
  bank_name: string;
  bank_branch: string;
  account_number: string;
  ifsc_code: string;
  swift_code: string;
  upi_vpa: string;
};

const EMPTY_FORM: FormValues = {
  display_name: "",
  legal_name: "",
  key: "",
  gst_number: "",
  pan_number: "",
  phone: "",
  email: "",
  address: "",
  bank_name: "",
  bank_branch: "",
  account_number: "",
  ifsc_code: "",
  swift_code: "",
  upi_vpa: "",
};

function toForm(c: Company): FormValues {
  return {
    display_name: c.display_name || "",
    legal_name: c.legal_name || "",
    key: c.key || "",
    gst_number: c.gst_number || "",
    pan_number: c.pan_number || "",
    phone: c.phone || "",
    email: c.email || "",
    address: c.address || "",
    bank_name: c.bank_name || "",
    bank_branch: c.bank_branch || "",
    account_number: c.account_number || "",
    ifsc_code: c.ifsc_code || "",
    swift_code: c.swift_code || "",
    upi_vpa: c.upi_vpa || "",
  };
}

export default function InvoiceCompaniesPage() {
  const router = useRouter();
  const { status } = useSession();

  // role gate
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  const [rows, setRows] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);

  // form / dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAdmin = role === "owner" || role === "manager";

  // ---- Gate: resolve the caller's vendor role ----
  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      router.replace("/vendor/login");
      return;
    }
    let active = true;
    (async () => {
      let r: string | null = null;
      try {
        const res = await fetch("/api/vendor/me", { cache: "no-store" });
        const json = await res.json();
        r = (json?.vendor?.role as string) ?? null;
      } catch {
        r = null;
      }
      if (active) {
        setRole(r);
        setRoleLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router, status]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/invoice-companies?mode=manage", {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        toast.error(json?.error || "Failed to load companies");
        setRows([]);
      } else {
        setRows((json.data || []) as Company[]);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load companies");
      setRows([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const setField = (k: keyof FormValues, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (c: Company) => {
    setEditingId(c.id);
    setForm(toForm(c));
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.display_name.trim()) {
      toast.error("Display name is required.");
      return;
    }
    setSaving(true);
    try {
      const url = editingId
        ? `/api/vendor/invoice-companies?id=${encodeURIComponent(editingId)}`
        : "/api/vendor/invoice-companies";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to save company");
      }
      toast.success(editingId ? "Company updated." : "Company created.");
      setDialogOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save company");
    }
    setSaving(false);
  };

  const remove = async (c: Company) => {
    const ok = window.confirm(`Delete "${c.display_name}" permanently?`);
    if (!ok) return;
    setDeletingId(c.id);
    try {
      const res = await fetch(
        `/api/vendor/invoice-companies?id=${encodeURIComponent(c.id)}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to delete company");
      }
      toast.success("Company deleted.");
      setRows((prev) => prev.filter((r) => r.id !== c.id));
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete company");
    }
    setDeletingId(null);
  };

  const hasBank = (c: Company) =>
    !!(c.bank_name || c.account_number || c.ifsc_code);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        a.display_name.localeCompare(b.display_name),
      ),
    [rows],
  );

  // ---- Loading / access states ----
  if (status === "loading" || roleLoading) {
    return (
      <div className="container mx-auto py-16 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-md py-16 text-center">
        <Card>
          <CardHeader>
            <ShieldAlert className="mx-auto mb-2 h-10 w-10 text-amber-500" />
            <CardTitle>View only — no access</CardTitle>
            <CardDescription>
              Invoice company management is available to owners and managers
              only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.push("/vendor")}>
              ← Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-gradient-to-r from-primary to-blue-700 text-primary-foreground shadow-sm">
        <div className="container mx-auto flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Landmark className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Invoice Companies</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-white/40 bg-white/10 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground"
            onClick={() => router.push("/vendor")}
          >
            ← Back to Dashboard
          </Button>
        </div>
      </header>

      <div className="container mx-auto max-w-6xl space-y-6 py-8">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Seller companies</CardTitle>
              <CardDescription>
                The companies printed on your invoices (with bank &amp; UPI
                payment details). Shared across your whole organisation.
              </CardDescription>
            </div>
            <Button onClick={openAdd}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Company
            </Button>
          </CardHeader>

          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <Building2 className="h-9 w-9 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No invoice companies yet.
                </p>
                <Button variant="outline" size="sm" onClick={openAdd}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add your first company
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b">
                      <th className="px-4 py-2 text-left font-semibold">
                        Company
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        GSTIN
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        Phone
                      </th>
                      <th className="px-4 py-2 text-center font-semibold">
                        Bank
                      </th>
                      <th className="px-4 py-2 text-center font-semibold">
                        UPI
                      </th>
                      <th className="px-4 py-2 text-center font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((c) => (
                      <tr key={c.id} className="border-t align-top">
                        <td className="px-4 py-2">
                          <div className="font-medium">{c.display_name}</div>
                          {c.legal_name && (
                            <div className="text-xs text-muted-foreground">
                              {c.legal_name}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground/70">
                            {c.key}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {c.gst_number || "—"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {c.phone || "—"}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {hasBank(c) ? (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              Yes
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {c.upi_vpa ? (
                            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              Yes
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEdit(c)}
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deletingId === c.id}
                              onClick={() => remove(c)}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              {deletingId === c.id ? "Deleting…" : "Delete"}
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

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit company" : "Add company"}
            </DialogTitle>
            <DialogDescription>
              Details shown on invoices, including bank and UPI payment
              information.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Identity */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Identity</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="display_name">
                    Display name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="display_name"
                    value={form.display_name}
                    onChange={(e) => setField("display_name", e.target.value)}
                    placeholder="My Company Pvt Ltd"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="legal_name">Legal name</Label>
                  <Input
                    id="legal_name"
                    value={form.legal_name}
                    onChange={(e) => setField("legal_name", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="key">Key</Label>
                  <Input
                    id="key"
                    value={form.key}
                    onChange={(e) => setField("key", e.target.value)}
                    placeholder="auto from display name"
                  />
                  <p className="text-xs text-muted-foreground">
                    Unique identifier. Leave blank to auto-generate.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gst_number">GST number</Label>
                  <Input
                    id="gst_number"
                    value={form.gst_number}
                    onChange={(e) => setField("gst_number", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pan_number">PAN number</Label>
                  <Input
                    id="pan_number"
                    value={form.pan_number}
                    onChange={(e) => setField("pan_number", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setField("email", e.target.value)}
                  />
                </div>
              </div>
            </section>

            {/* Address */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Address</h3>
              <div className="space-y-1.5">
                <Label htmlFor="address">Registered address</Label>
                <Textarea
                  id="address"
                  rows={3}
                  value={form.address}
                  onChange={(e) => setField("address", e.target.value)}
                />
              </div>
            </section>

            {/* Bank details */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Bank details
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bank_name">Bank name</Label>
                  <Input
                    id="bank_name"
                    value={form.bank_name}
                    onChange={(e) => setField("bank_name", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bank_branch">Branch</Label>
                  <Input
                    id="bank_branch"
                    value={form.bank_branch}
                    onChange={(e) => setField("bank_branch", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="account_number">Account number</Label>
                  <Input
                    id="account_number"
                    value={form.account_number}
                    onChange={(e) =>
                      setField("account_number", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ifsc_code">IFSC code</Label>
                  <Input
                    id="ifsc_code"
                    value={form.ifsc_code}
                    onChange={(e) => setField("ifsc_code", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="swift_code">SWIFT code</Label>
                  <Input
                    id="swift_code"
                    value={form.swift_code}
                    onChange={(e) => setField("swift_code", e.target.value)}
                  />
                </div>
              </div>
            </section>

            {/* UPI */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">UPI</h3>
              <div className="space-y-1.5">
                <Label htmlFor="upi_vpa">UPI VPA</Label>
                <Input
                  id="upi_vpa"
                  value={form.upi_vpa}
                  onChange={(e) => setField("upi_vpa", e.target.value)}
                  placeholder="yourbiz@okhdfcbank"
                />
                <p className="text-xs text-muted-foreground">
                  e.g. yourbiz@okhdfcbank; used for the invoice payment QR.
                </p>
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving
                ? "Saving…"
                : editingId
                  ? "Save changes"
                  : "Create company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
