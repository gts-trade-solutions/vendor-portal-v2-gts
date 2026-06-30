"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  GitMerge,
  ShieldAlert,
  ArrowLeft,
  Package,
  Boxes,
  CheckCircle2,
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

type Pair = {
  survivor_id: string;
  survivor_name: string;
  online_price: number | null;
  survivor_vendor_price: number | null;
  duplicate_id: string;
  duplicate_name: string;
  duplicate_vendor_price: number | null;
  duplicate_units: number;
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const money = (v: number | null | undefined) =>
  v == null ? "—" : inr.format(Number(v) || 0);

export default function MergeDuplicatesPage() {
  const router = useRouter();
  const { status } = useSession();

  // role gate
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(false);
  // per-pair editable vendor price input (keyed by duplicate_id)
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [mergingId, setMergingId] = useState<string | null>(null);

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
      const res = await fetch("/api/vendor/products/merge", {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        toast.error(json?.error || "Failed to load merge candidates");
        setPairs([]);
      } else {
        const list = (json.pairs || []) as Pair[];
        setPairs(list);
        // Pre-fill each vendor-price input with the survivor's online price.
        setPrices(
          Object.fromEntries(
            list.map((p) => [
              p.duplicate_id,
              p.online_price != null ? String(p.online_price) : "",
            ]),
          ),
        );
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load merge candidates");
      setPairs([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const merge = async (p: Pair) => {
    const ok = window.confirm(
      `Merge "${p.duplicate_name}" into "${p.survivor_name}"? ${p.duplicate_units} units will move and the duplicate will be archived.`,
    );
    if (!ok) return;

    const vp = prices[p.duplicate_id];
    setMergingId(p.duplicate_id);
    try {
      const res = await fetch("/api/vendor/products/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          survivor_id: p.survivor_id,
          duplicate_id: p.duplicate_id,
          vendor_price: vp,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Merge failed");
      }
      const moved = Number(json?.unitsMoved ?? p.duplicate_units) || 0;
      toast.success(`Merged — ${moved} units moved`);
      setPairs((prev) => prev.filter((x) => x.duplicate_id !== p.duplicate_id));
    } catch (e: any) {
      toast.error(e?.message || "Merge failed");
    }
    setMergingId(null);
  };

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
              Merging duplicate products is available to owners and managers
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
            <GitMerge className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Merge Duplicate Products</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-white/40 bg-white/10 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground"
            onClick={() => router.push("/vendor/products")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Products
          </Button>
        </div>
      </header>

      <div className="container mx-auto max-w-5xl space-y-6 py-8">
        <p className="text-sm text-muted-foreground">
          These products exist twice — a published storefront version and a
          hidden inventory version. Merging moves the inventory stock onto the
          storefront product (so it sells online + offline from one product) and
          archives the duplicate.
        </p>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="space-y-3 py-6">
                  <div className="h-5 w-1/3 animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
                  <div className="h-9 w-full animate-pulse rounded bg-slate-100" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : pairs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="text-base font-medium">
                No duplicate products to merge ✅
              </p>
              <p className="text-sm text-muted-foreground">
                Every product is unified.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {pairs.map((p) => (
              <Card key={p.duplicate_id}>
                <CardHeader>
                  <CardTitle className="text-lg">{p.survivor_name}</CardTitle>
                  <CardDescription>
                    Merging the hidden inventory copy into this published
                    storefront product.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Survivor (storefront) */}
                    <div className="rounded-lg border bg-emerald-50/40 p-4">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        <Package className="h-3.5 w-3.5" />
                        Storefront (kept)
                      </div>
                      <div className="font-medium">{p.survivor_name}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Online price:{" "}
                        <span className="font-semibold text-foreground">
                          {money(p.online_price)}
                        </span>
                      </div>
                    </div>

                    {/* Duplicate (hidden) */}
                    <div className="rounded-lg border bg-amber-50/40 p-4">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                        <Boxes className="h-3.5 w-3.5" />
                        Inventory (archived)
                      </div>
                      <div className="font-medium">{p.duplicate_name}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Units to move:{" "}
                        <span className="font-semibold text-foreground">
                          {p.duplicate_units}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Vendor price + merge action */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="space-y-1.5 sm:max-w-xs sm:flex-1">
                      <Label htmlFor={`vp-${p.duplicate_id}`}>
                        Vendor price
                      </Label>
                      <Input
                        id={`vp-${p.duplicate_id}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={prices[p.duplicate_id] ?? ""}
                        onChange={(e) =>
                          setPrices((prev) => ({
                            ...prev,
                            [p.duplicate_id]: e.target.value,
                          }))
                        }
                        placeholder="e.g. 499"
                      />
                      <p className="text-xs text-muted-foreground">
                        Price for offline/invoice sales (defaults to the online
                        price).
                      </p>
                    </div>
                    <Button
                      onClick={() => merge(p)}
                      disabled={mergingId === p.duplicate_id}
                    >
                      <GitMerge className="mr-1.5 h-4 w-4" />
                      {mergingId === p.duplicate_id ? "Merging…" : "Merge"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
