"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
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
import {
  Settings as SettingsIcon,
  Building2,
  Bell,
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
  Info,
} from "lucide-react";

type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
};

type ProfileData = {
  id: string;
  display_name: string;
  legal_name: string | null;
  slug: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  website: string | null;
  address_json: Address | null;
  expiry_alert_days: number;
  commission_rate: number | null;
  status: string;
  created_at: string | null;
};

const inr = (v: unknown) => `${Number(v ?? 0)}%`;

function statusBadgeClass(status: string) {
  if (status === "approved") return "bg-emerald-100 text-emerald-700";
  if (status === "pending") return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function passwordStrengthHint(pw: string) {
  if (!pw) return null;
  const checks = [
    { ok: pw.length >= 8, label: "8+ chars" },
    { ok: /[A-Z]/.test(pw), label: "uppercase" },
    { ok: /\d/.test(pw), label: "number" },
    { ok: /[^A-Za-z0-9\s]/.test(pw), label: "symbol" },
  ];
  return checks;
}

export default function VendorSettingsPage() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();

  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const canEdit = role === "owner" || role === "manager";

  // Business profile + preferences form state.
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [website, setWebsite] = useState("");
  const [addr, setAddr] = useState<Address>({});
  const [expiryAlertDays, setExpiryAlertDays] = useState("");
  const [saving, setSaving] = useState(false);

  // Read-only info.
  const [commissionRate, setCommissionRate] = useState<number | null>(null);
  const [vendorStatus, setVendorStatus] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  // Change-password form state.
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  // Gate: bounce unauthenticated; otherwise load profile + role.
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (sessionStatus === "unauthenticated") {
      router.replace("/vendor/login");
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      // role comes from /api/vendor/me (matches the team page gating pattern)
      try {
        const meRes = await fetch("/api/vendor/me", { cache: "no-store" });
        const meJson = await meRes.json().catch(() => ({}));
        if (!cancelled) setRole(meJson?.vendor?.role ?? null);
      } catch {
        /* role stays null → read-only */
      }

      try {
        const res = await fetch("/api/vendor/profile", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) {
          if (!cancelled) router.replace("/vendor/login");
          return;
        }
        if (!res.ok || !json?.ok) {
          if (!cancelled) toast.error(json?.error || "Failed to load profile");
        } else if (!cancelled) {
          const d = json.data as ProfileData;
          setDisplayName(d.display_name ?? "");
          setLegalName(d.legal_name ?? "");
          setSlug(d.slug ?? "");
          setEmail(d.email ?? "");
          setPhone(d.phone ?? "");
          setGstin(d.gstin ?? "");
          setWebsite(d.website ?? "");
          setAddr((d.address_json as Address) ?? {});
          setExpiryAlertDays(String(d.expiry_alert_days ?? ""));
          setCommissionRate(d.commission_rate ?? null);
          setVendorStatus(d.status ?? "");
          setCreatedAt(d.created_at ?? null);
        }
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Failed to load profile");
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, sessionStatus]);

  const saveProfile = async () => {
    if (!displayName.trim()) {
      toast.error("Display name is required.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/vendor/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: displayName.trim(),
        legal_name: legalName.trim() || null,
        slug: slug.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        gstin: gstin.trim() || null,
        website: website.trim() || null,
        address_json: addr,
        expiry_alert_days: expiryAlertDays === "" ? undefined : Number(expiryAlertDays),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !json?.ok) {
      toast.error(json?.error || "Failed to save profile");
      return;
    }
    toast.success("Profile saved.");
    // Reflect any server-side slug normalisation.
    const d = json.data as ProfileData;
    if (d?.slug != null) setSlug(d.slug);
    if (d?.expiry_alert_days != null) setExpiryAlertDays(String(d.expiry_alert_days));
  };

  const changePassword = async () => {
    if (newPw !== confirmPw) {
      toast.error("New password and confirmation do not match.");
      return;
    }
    setChangingPw(true);
    const res = await fetch("/api/vendor/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });
    const json = await res.json().catch(() => ({}));
    setChangingPw(false);
    if (!res.ok || !json?.ok) {
      toast.error(json?.error || "Failed to change password");
      return;
    }
    toast.success("Password updated.");
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
  };

  const setAddrField = (k: keyof Address, v: string) =>
    setAddr((prev) => ({ ...prev, [k]: v }));

  const strength = passwordStrengthHint(newPw);

  return (
    <div className="min-h-screen">
      <header className="border-b bg-gradient-to-r from-primary to-blue-700 text-primary-foreground shadow-sm">
        <div className="container mx-auto flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <SettingsIcon className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Settings</h1>
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

      <div className="container mx-auto max-w-4xl space-y-6 py-8">
        {loading ? (
          <div className="py-16 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            {!canEdit && (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <Info className="h-4 w-4 shrink-0" />
                You have view-only access. Only owners and managers can edit the
                business profile.
              </div>
            )}

            {canEdit && (
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-primary" />
                      Invoice Companies
                    </CardTitle>
                    <CardDescription>
                      Manage the seller entities &amp; bank details printed on
                      your invoices.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => router.push("/vendor/invoice-companies")}
                  >
                    Manage Companies
                  </Button>
                </CardHeader>
              </Card>
            )}

            {/* Business Profile */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  Business Profile
                </CardTitle>
                <CardDescription>
                  Your business identity and contact details.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="display_name">Display name *</Label>
                    <Input
                      id="display_name"
                      value={displayName}
                      disabled={!canEdit}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="legal_name">Legal name</Label>
                    <Input
                      id="legal_name"
                      value={legalName}
                      disabled={!canEdit}
                      onChange={(e) => setLegalName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="slug">Slug</Label>
                    <Input
                      id="slug"
                      value={slug}
                      disabled={!canEdit}
                      onChange={(e) => setSlug(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Used in your public URL. Changing it can break old links.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Contact email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      disabled={!canEdit}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={phone}
                      disabled={!canEdit}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="gstin">GSTIN</Label>
                    <Input
                      id="gstin"
                      value={gstin}
                      disabled={!canEdit}
                      onChange={(e) => setGstin(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="website">Website</Label>
                    <Input
                      id="website"
                      placeholder="https://…"
                      value={website}
                      disabled={!canEdit}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </div>
                </div>

                {/* Address sub-group */}
                <div className="space-y-3 rounded-lg border bg-slate-50/60 p-4">
                  <div className="text-sm font-semibold text-slate-700">
                    Business address
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-2 md:col-span-3">
                      <Label htmlFor="line1">Address line 1</Label>
                      <Input
                        id="line1"
                        value={addr.line1 ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setAddrField("line1", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2 md:col-span-3">
                      <Label htmlFor="line2">Address line 2</Label>
                      <Input
                        id="line2"
                        value={addr.line2 ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setAddrField("line2", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={addr.city ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setAddrField("city", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="state">State</Label>
                      <Input
                        id="state"
                        value={addr.state ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setAddrField("state", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pincode">Pincode</Label>
                      <Input
                        id="pincode"
                        value={addr.pincode ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setAddrField("pincode", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="country">Country</Label>
                      <Input
                        id="country"
                        value={addr.country ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setAddrField("country", e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {canEdit && (
                  <div className="flex justify-end">
                    <Button onClick={saveProfile} disabled={saving}>
                      {saving ? "Saving…" : "Save profile"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Preferences */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-primary" />
                  Preferences
                </CardTitle>
                <CardDescription>
                  Controls used by the dashboard and expiry alerts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="max-w-xs space-y-1.5">
                  <Label htmlFor="expiry_alert_days">Expiry alert window (days)</Label>
                  <Input
                    id="expiry_alert_days"
                    type="number"
                    min={1}
                    max={3650}
                    value={expiryAlertDays}
                    disabled={!canEdit}
                    onChange={(e) => setExpiryAlertDays(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Units expiring within this many days are flagged on the
                    dashboard.
                  </p>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <Button onClick={saveProfile} disabled={saving} variant="outline">
                      {saving ? "Saving…" : "Save preferences"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Account / Security */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-5 w-5 text-primary" />
                  Account &amp; Security
                </CardTitle>
                <CardDescription>Change your sign-in password.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="current_pw">Current password</Label>
                    <div className="relative">
                      <Input
                        id="current_pw"
                        type={showCurrent ? "text" : "password"}
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowCurrent((s) => !s)}
                        aria-label="Toggle current password visibility"
                      >
                        {showCurrent ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new_pw">New password</Label>
                    <div className="relative">
                      <Input
                        id="new_pw"
                        type={showNew ? "text" : "password"}
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowNew((s) => !s)}
                        aria-label="Toggle new password visibility"
                      >
                        {showNew ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm_pw">Confirm new password</Label>
                    <div className="relative">
                      <Input
                        id="confirm_pw"
                        type={showConfirm ? "text" : "password"}
                        value={confirmPw}
                        onChange={(e) => setConfirmPw(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowConfirm((s) => !s)}
                        aria-label="Toggle confirm password visibility"
                      >
                        {showConfirm ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {strength && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {strength.map((c) => (
                      <span
                        key={c.label}
                        className={`rounded px-2 py-0.5 ${
                          c.ok
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {c.ok ? "✓" : "•"} {c.label}
                      </span>
                    ))}
                    {confirmPw.length > 0 && (
                      <span
                        className={`rounded px-2 py-0.5 ${
                          newPw === confirmPw
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {newPw === confirmPw ? "✓ match" : "✗ no match"}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={changePassword}
                    disabled={changingPw || !newPw || !confirmPw}
                  >
                    {changingPw ? "Updating…" : "Change password"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Read-only platform info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  Account Information
                </CardTitle>
                <CardDescription>
                  Platform-managed details (read only).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Status</div>
                    <span
                      className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(
                        vendorStatus,
                      )}`}
                    >
                      {vendorStatus || "—"}
                    </span>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Commission rate
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {commissionRate == null ? "—" : inr(commissionRate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Member since</div>
                    <div className="mt-1 text-sm font-medium">
                      {createdAt
                        ? new Date(createdAt).toLocaleDateString("en-IN", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })
                        : "—"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
