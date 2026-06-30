"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Upload } from "lucide-react";
import { uploadMedia, deleteMedia } from "@/lib/storage/upload-client";
import { resolveMediaUrl } from "@/lib/storage/backend";

const MEDIA_BUCKET = "product-media";

/* ──────────────────────────────────────────────────────────────
   Local Toast (custom, no dependency)
   ────────────────────────────────────────────────────────────── */
type ToastType = "success" | "error" | "info" | "warning";
type ToastMsg = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
};
function ToastStack({
  toasts,
  onClose,
}: {
  toasts: ToastMsg[];
  onClose: (id: string) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-[9999] space-y-2 w-[360px] max-w-[90vw]">
      {toasts.map((t) => {
        const border =
          t.type === "success"
            ? "border-green-500"
            : t.type === "error"
              ? "border-red-500"
              : t.type === "warning"
                ? "border-amber-500"
                : "border-slate-300";

        const bg =
          t.type === "success"
            ? "bg-green-50"
            : t.type === "error"
              ? "bg-red-50"
              : t.type === "warning"
                ? "bg-amber-50"
                : "bg-white";

        return (
          <div
            key={t.id}
            className={`rounded-md border ${border} ${bg} shadow-md p-3`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm">{t.title}</div>
                {t.description ? (
                  <div className="text-xs text-slate-700 mt-1 whitespace-pre-line">
                    {t.description}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="text-slate-600 hover:text-slate-900 text-sm"
                onClick={() => onClose(t.id)}
                aria-label="Close toast"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
function skuify(s: string) {
  return s
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
function safeKeyPart(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
function parseBool(v: any) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "y"].includes(s);
}

type VendorInfo = {
  id: string;
  display_name: string;
  status: "pending" | "approved" | "rejected" | "disabled";
};

type BrandRow = { id: string; slug?: string | null; name?: string | null };
type CategoryRow = { id: string; slug?: string | null; name?: string | null };

type ImageRow = {
  id?: string;
  file?: File;
  storage_path?: string;
  alt: string;
  sort_order: number;
  remove?: boolean;
};

type ProductModel = {
  id?: string;
  vendor_id?: string;

  sku: string;
  slug: string;
  name: string;
  brand_id: string | "";
  category_id: string | "";

  // ✅ NEW
  hsn: string;

  price: number | null;
  purchase_price: number | null;
  currency: string;

  short_description: string;
  description: string;

  // inventory + expiry
  track_inventory: boolean;
  stock_qty: number;
  expiry_date: string; // YYYY-MM-DD or ""

  // publish & price
  is_published: boolean;
  compare_at_price: number | null;
  sale_price: number | null;
  vendor_price: number | null;
  sale_starts_at: string | "";
  sale_ends_at: string | "";

  // badges
  made_in_korea: boolean;
  is_vegetarian: boolean;
  cruelty_free: boolean;
  toxin_free: boolean;
  paraben_free: boolean;

  // SEO / rich
  meta_title: string;
  meta_description: string;
  ingredients_md: string;
  key_features_md: string;
  additional_details_md: string;
  attributes_json: string;
  faq_text: string;
  key_benefits_text: string;

  // misc
  volume_ml: number | null;
  net_weight_g: number | null;
  country_of_origin: string;

  // media
  images: ImageRow[];
  video_file?: File | null;
  video_path?: string | null;
  remove_video?: boolean;
};

export function ProductEditor({
  mode,
  productId,
}: {
  mode: "create" | "edit";
  productId?: string;
}) {
  const router = useRouter();
  // Cookie-based NextAuth session — used to gate hydration (replaces
  // supabase.auth.getSession()). All data calls are plain same-origin fetches.
  const { status: sessionStatus } = useSession();

  // ✅ local toast state
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const pushToast = (t: Omit<ToastMsg, "id">, ms = 3000) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, ms);
  };
  const closeToast = (id: string) =>
    setToasts((prev) => prev.filter((x) => x.id !== id));

  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [model, setModel] = useState<ProductModel>(() => ({
    sku: "",
    slug: "",
    name: "",
    brand_id: "",
    category_id: "",

    // ✅ NEW default
    hsn: "",

    price: null,
    purchase_price: null,
    currency: "INR",
    short_description: "",
    description: "",

    track_inventory: true,
    stock_qty: 0,
    expiry_date: "",

    is_published: true,
    compare_at_price: null,
    sale_price: null,
    vendor_price: null,
    sale_starts_at: "",
    sale_ends_at: "",

    made_in_korea: false,
    is_vegetarian: false,
    cruelty_free: false,
    toxin_free: false,
    paraben_free: false,

    meta_title: "",
    meta_description: "",
    ingredients_md: "",
    key_features_md: "",
    additional_details_md: "",
    attributes_json: "{}",
    faq_text: "",
    key_benefits_text: "",

    volume_ml: null,
    net_weight_g: null,
    country_of_origin: "",

    images: [],
    video_file: null,
    video_path: null,
    remove_video: false,
  }));

  const [busy, setBusy] = useState(false);
  const [overwriteStorage, setOverwriteStorage] = useState(false);
  const [deleteMediaFromStorage, setDeleteMediaFromStorage] = useState(false);

  useEffect(() => {
    // Wait for NextAuth to resolve the cookie session before loading.
    if (sessionStatus === "loading") return;
    if (sessionStatus === "unauthenticated") {
      router.replace("/vendor/login");
      return;
    }

    let cancelled = false;
    (async () => {
      // Vendor gate — server-side, NextAuth-scoped (replaces get_my_vendor RPC).
      let v: VendorInfo | undefined;
      try {
        const res = await fetch("/api/vendor/me", { cache: "no-store" });
        const body = await res.json();
        const raw = body?.vendor;
        const vArr = Array.isArray(raw) ? raw : raw ? [raw] : [];
        v = vArr[0] as VendorInfo | undefined;
      } catch (e: any) {
        pushToast({
          type: "error",
          title: "Vendor error",
          description: e?.message || "Failed to load vendor",
        });
        router.replace("/vendor");
        return;
      }

      if (!v) {
        router.replace("/vendor/register");
        return;
      }
      if (v.status !== "approved") {
        router.replace("/vendor");
        return;
      }
      if (cancelled) return;
      setVendor(v);

      const [brRes, catRes] = await Promise.all([
        fetch("/api/vendor/brands", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/vendor/categories", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      if (!cancelled) {
        setBrands((brRes?.data as any[]) || []);
        setCategories((catRes?.data as any[]) || []);
      }

      if (mode === "edit" && productId) {
        let body: any = null;
        try {
          const res = await fetch(
            `/api/vendor/products?mode=edit&id=${encodeURIComponent(productId)}`,
            { cache: "no-store" },
          );
          body = await res.json();
          if (!res.ok || !body?.ok) {
            if (res.status === 404) {
              pushToast({ type: "error", title: "Product not found" });
              router.replace("/vendor/products");
              return;
            }
            pushToast({
              type: "error",
              title: "Load failed",
              description: body?.error || "Load failed",
            });
            return;
          }
        } catch (e: any) {
          pushToast({
            type: "error",
            title: "Load failed",
            description: e?.message || "Load failed",
          });
          return;
        }

        const prod = body.data;
        const imgs = (body.images ?? []) as any[];

        if (cancelled) return;

        setModel((m) => ({
          ...m,
          id: prod.id,
          vendor_id: prod.vendor_id,
          sku: prod.sku || "",
          slug: prod.slug || "",
          name: prod.name || "",
          brand_id: prod.brand_id || "",
          category_id: prod.category_id || "",

          // ✅ NEW load
          hsn: prod.hsn || "",

          price: prod.price ?? null,
          currency: prod.currency || "INR",
          short_description: prod.short_description || "",
          description: prod.description || "",

          track_inventory: parseBool(prod.track_inventory ?? true),
          stock_qty: Number(prod.stock_qty ?? 0),
          expiry_date: prod.expiry_date
            ? String(prod.expiry_date).slice(0, 10)
            : "",

          is_published: parseBool(prod.is_published),
          purchase_price: prod.purchase_price ?? null,
          compare_at_price: prod.compare_at_price ?? null,
          sale_price: prod.sale_price ?? null,
          vendor_price: prod.vendor_price ?? null,
          sale_starts_at: prod.sale_starts_at || "",
          sale_ends_at: prod.sale_ends_at || "",
          made_in_korea: parseBool(prod.made_in_korea),
          is_vegetarian: parseBool(prod.is_vegetarian),
          cruelty_free: parseBool(prod.cruelty_free),
          toxin_free: parseBool(prod.toxin_free),
          paraben_free: parseBool(prod.paraben_free),
          meta_title: prod.meta_title || "",
          meta_description: prod.meta_description || "",
          ingredients_md: prod.ingredients_md || "",
          key_features_md: prod.key_features_md || "",
          additional_details_md: prod.additional_details_md || "",
          attributes_json: JSON.stringify(prod.attributes ?? {}, null, 0),
          faq_text: ((prod.faq ?? []) as any[])
            .map((x: any) => `${x?.q ?? ""}::${x?.a ?? ""}`)
            .filter(Boolean)
            .join("||"),
          key_benefits_text: ((prod.key_benefits ?? []) as any[]).join("|"),
          volume_ml: prod.volume_ml ?? null,
          net_weight_g: prod.net_weight_g ?? null,
          country_of_origin: prod.country_of_origin || "",
          video_path: prod.video_path ?? null,
          images: (imgs ?? []).map((r) => ({
            id: r.id,
            storage_path: r.storage_path,
            alt: r.alt ?? "",
            sort_order: r.sort_order ?? 0,
          })),
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, productId, router, sessionStatus]);

  const addImageSlot = () => {
    setModel((m) => {
      if (m.images.length >= 5) return m;
      const nextSort = (m.images[m.images.length - 1]?.sort_order ?? -1) + 1;
      return {
        ...m,
        images: [...m.images, { alt: "", sort_order: Math.max(0, nextSort) }],
      };
    });
  };

  const removeImageSlot = (idx: number) => {
    setModel((m) => {
      const copy = [...m.images];
      const row = copy[idx];
      if (row?.id) copy[idx] = { ...row, remove: true };
      else copy.splice(idx, 1);
      return { ...m, images: copy };
    });
  };

  const canSave = useMemo(() => {
    return !!model.name && !!model.brand_id && !!model.category_id;
  }, [model]);

  const onSave = async (closeAfter = false) => {
    if (!vendor) {
      pushToast({ type: "error", title: "Vendor not ready" });
      return;
    }
    if (!canSave) {
      pushToast({
        type: "error",
        title: "Missing fields",
        description: "Please fill name, brand and category",
      });
      return;
    }

    setBusy(true);

    try {
      let sku = model.sku?.trim();
      if (!sku) {
        const seed = model.slug?.trim() || model.name || "PRODUCT";
        sku = skuify(seed);
      } else sku = skuify(sku);

      let slug = model.slug?.trim();
      if (!slug) slug = slugify(sku || model.name || "product");
      else slug = slugify(slug);

      const payload: any = {
        sku,
        slug,
        name: model.name,
        brand_id: model.brand_id || null,
        category_id: model.category_id || null,

        // ✅ NEW save
        hsn: model.hsn?.trim() || null,

        short_description: model.short_description || null,
        description: model.description || null,

        price: model.price ?? null,
        purchase_price: model.purchase_price ?? 0,
        currency: model.currency || "INR",
        compare_at_price: model.compare_at_price ?? null,
        sale_price: model.sale_price ?? null,
        vendor_price: model.vendor_price ?? null,
        sale_starts_at: model.sale_starts_at || null,
        sale_ends_at: model.sale_ends_at || null,
        is_published: !!model.is_published,

        track_inventory: !!model.track_inventory,
        stock_qty: Math.max(0, Number(model.stock_qty || 0)),
        expiry_date: model.expiry_date ? model.expiry_date : null,

        made_in_korea: !!model.made_in_korea,
        is_vegetarian: !!model.is_vegetarian,
        cruelty_free: !!model.cruelty_free,
        toxin_free: !!model.toxin_free,
        paraben_free: !!model.paraben_free,

        meta_title: model.meta_title || null,
        meta_description: model.meta_description || null,
        ingredients_md: model.ingredients_md || null,
        key_features_md: model.key_features_md || null,
        additional_details_md: model.additional_details_md || null,
        attributes: (() => {
          try {
            return JSON.parse(model.attributes_json || "{}");
          } catch {
            return {};
          }
        })(),
        faq: (model.faq_text || "")
          .split("||")
          .map((pair) => {
            const [q, a] = pair.split("::").map((x) => (x ?? "").trim());
            if (!q && !a) return null;
            return { q, a };
          })
          .filter(Boolean),
        key_benefits: (model.key_benefits_text || "")
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean),

        volume_ml: model.volume_ml ?? null,
        net_weight_g: model.net_weight_g ?? null,
        country_of_origin: model.country_of_origin || null,
      };

      let prodId = model.id;

      if (mode === "create") {
        const res = await fetch("/api/vendor/products/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload }),
        });
        const body = await res.json().catch(() => ({} as any));
        if (!res.ok || !body?.ok) throw new Error(body?.error || "Create failed");
        prodId = body.id;
      } else {
        const res = await fetch("/api/vendor/products/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: productId, payload }),
        });
        const body = await res.json().catch(() => ({} as any));
        if (!res.ok || !body?.ok) throw new Error(body?.error || "Update failed");
        prodId = body.id;
      }

      if (!prodId) throw new Error("No product id");

      // =======================
      // Media handling — uploads via the backend-toggle uploader; DB writes via
      // the vendor media endpoint (transactional, vendor-scoped).
      // =======================
      const safeSku = safeKeyPart(sku);
      const imgRows: {
        storage_path: string;
        alt: string | null;
        sort_order: number;
      }[] = [];
      const toDeleteImgIds: string[] = [];

      for (const row of model.images) {
        if (row.remove && row.id) {
          toDeleteImgIds.push(row.id);
          continue;
        }
        let storage_path = row.storage_path;
        if (row.file) {
          const cleanName = safeKeyPart(row.file.name);
          const key = `${safeSku}/${cleanName}`;
          try {
            const up = await uploadMedia(MEDIA_BUCKET, key, row.file, {
              upsert: overwriteStorage,
            });
            storage_path = up.path;
          } catch (e: any) {
            if (
              e?.message?.includes("already exists") &&
              !overwriteStorage
            ) {
              throw new Error(`Image already exists in storage: ${key}`);
            }
            throw e;
          }
        }
        if (storage_path) {
          imgRows.push({
            storage_path,
            alt: row.alt || null,
            sort_order: Number.isFinite(row.sort_order as any)
              ? (row.sort_order as number)
              : 0,
          });
        }
      }

      // Video upload (storage). The path is sent to the media endpoint which
      // sets/clears products.video_path inside its transaction.
      let nextVideoPath: string | null = model.video_path || null;
      const removeVideo = !!model.remove_video;
      if (removeVideo) {
        nextVideoPath = null;
      } else if (model.video_file) {
        const cleanVid = safeKeyPart(model.video_file.name);
        const key = `${safeSku}/video/${cleanVid}`;
        try {
          const up = await uploadMedia(MEDIA_BUCKET, key, model.video_file, {
            upsert: overwriteStorage,
          });
          nextVideoPath = up.path;
        } catch (e: any) {
          if (e?.message?.includes("already exists") && !overwriteStorage) {
            throw new Error(`Video already exists in storage: ${key}`);
          }
          throw e;
        }
      }

      // Persist all media DB changes in one transactional call.
      const mediaRes = await fetch("/api/vendor/products/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: prodId,
          imgRows,
          toDeleteImgIds,
          removeVideo,
          videoPath: removeVideo ? null : nextVideoPath,
        }),
      });
      const mediaBody = await mediaRes.json().catch(() => ({} as any));
      if (!mediaRes.ok || !mediaBody?.ok) {
        throw new Error(mediaBody?.error || "Media save failed");
      }

      // Optional storage cleanup of removed objects (the "Delete files from
      // storage on remove" toggle). Best-effort, never blocks.
      if (deleteMediaFromStorage) {
        const removedImagePaths: string[] = mediaBody.removedImagePaths ?? [];
        for (const p of removedImagePaths) {
          await deleteMedia(MEDIA_BUCKET, p);
        }
        const removedVideoPath: string | null = mediaBody.removedVideoPath ?? null;
        if (removedVideoPath) await deleteMedia(MEDIA_BUCKET, removedVideoPath);
      }

      pushToast({
        type: "success",
        title: mode === "create" ? "Product created" : "Product saved",
      });

      if (closeAfter) router.push("/vendor/products");
      else if (mode === "create") router.push(`/vendor/products/${prodId}`);
    } catch (e: any) {
      pushToast({
        type: "error",
        title: "Save failed",
        description: e?.message || "Save failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const [publicUrls, setPublicUrls] = useState<Record<number, string>>({});
  useEffect(() => {
    const out: Record<number, string> = {};
    model.images.forEach((row, idx) => {
      if (row.storage_path && !row.file) {
        const url = resolveMediaUrl(MEDIA_BUCKET, row.storage_path);
        if (url) out[idx] = url;
      }
    });
    setPublicUrls(out);
  }, [model.images]);

  if (!vendor)
    return (
      <div className="container mx-auto py-16 text-muted-foreground">
        <ToastStack toasts={toasts} onClose={closeToast} />
        Loading…
      </div>
    );

  return (
    <div className="container mx-auto py-6">
      <ToastStack toasts={toasts} onClose={closeToast} />

      <div className="mb-4">
        <Button variant="ghost" onClick={() => router.push("/vendor/products")}>
          ← Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {mode === "create" ? "Add Product" : "Edit Product"}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-8">
          {/* Identity */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Name</Label>
              <Input
                value={model.name}
                onChange={(e) =>
                  setModel((m) => ({ ...m, name: e.target.value }))
                }
              />
            </div>

            <div>
              <Label>Slug (leave blank to auto-generate)</Label>
              <Input
                value={model.slug}
                onChange={(e) =>
                  setModel((m) => ({ ...m, slug: e.target.value }))
                }
              />
            </div>

            <div>
              <Label>SKU (leave blank to auto-generate)</Label>
              <Input
                value={model.sku}
                onChange={(e) =>
                  setModel((m) => ({ ...m, sku: e.target.value }))
                }
              />
            </div>

            {/* ✅ NEW: HSN */}
            <div>
              <Label>HSN</Label>
              <Input
                value={model.hsn}
                onChange={(e) =>
                  setModel((m) => ({ ...m, hsn: e.target.value }))
                }
                placeholder="e.g. 33049990"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 md:col-span-2">
              <div>
                <Label>Brand</Label>
                <select
                  className="w-full h-10 border rounded-md bg-background px-3"
                  value={model.brand_id}
                  onChange={(e) =>
                    setModel((m) => ({ ...m, brand_id: e.target.value }))
                  }
                >
                  <option value="">Select brand</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.slug || b.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label>Category</Label>
                <select
                  className="w-full h-10 border rounded-md bg-background px-3"
                  value={model.category_id}
                  onChange={(e) =>
                    setModel((m) => ({ ...m, category_id: e.target.value }))
                  }
                >
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.slug || c.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Copy */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Short description</Label>
              <Textarea
                rows={3}
                value={model.short_description}
                onChange={(e) =>
                  setModel((m) => ({ ...m, short_description: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={6}
                value={model.description}
                onChange={(e) =>
                  setModel((m) => ({ ...m, description: e.target.value }))
                }
              />
            </div>
          </section>

          {/* Pricing & Publish */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Price</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={model.price ?? ""}
                onChange={(e) =>
                  setModel((m) => ({
                    ...m,
                    price: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
            </div>
            <div>
              <Label>Compare at price</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={model.compare_at_price ?? ""}
                onChange={(e) =>
                  setModel((m) => ({
                    ...m,
                    compare_at_price: e.target.value
                      ? Number(e.target.value)
                      : null,
                  }))
                }
              />
            </div>
            <div>
              <Label>Sale price</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={model.sale_price ?? ""}
                onChange={(e) =>
                  setModel((m) => ({
                    ...m,
                    sale_price: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
            </div>
            <div>
              <Label>Purchase price (internal)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Cost price — not shown to customers"
                value={model.purchase_price ?? ""}
                onChange={(e) =>
                  setModel((m) => ({
                    ...m,
                    purchase_price: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Used only for stock valuation &amp; profit (internal).
              </p>
            </div>
            <div>
              <Label>Vendor price (offline / invoice sales)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={model.vendor_price ?? ""}
                onChange={(e) =>
                  setModel((m) => ({
                    ...m,
                    vendor_price: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Price used on vendor invoices / offline sales. The storefront
                uses the Online price.
              </p>
              {(() => {
                const cost = model.purchase_price;
                if (cost == null || cost <= 0) return null;
                const fmtMargin = (sale: number | null) => {
                  if (sale == null) return null;
                  const diff = sale - cost;
                  const pct = (diff / cost) * 100;
                  return `₹${diff.toLocaleString("en-IN")} (${pct.toFixed(0)}%)`;
                };
                const online = fmtMargin(model.price);
                const vendor = fmtMargin(model.vendor_price);
                if (!online && !vendor) return null;
                return (
                  <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {online ? <div>Online margin: {online}</div> : null}
                    {vendor ? <div>Vendor margin: {vendor}</div> : null}
                  </div>
                );
              })()}
            </div>
            <div>
              <Label>Sale starts at</Label>
              <Input
                type="datetime-local"
                value={model.sale_starts_at || ""}
                onChange={(e) =>
                  setModel((m) => ({ ...m, sale_starts_at: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Sale ends at</Label>
              <Input
                type="datetime-local"
                value={model.sale_ends_at || ""}
                onChange={(e) =>
                  setModel((m) => ({ ...m, sale_ends_at: e.target.value }))
                }
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={model.is_published}
                onCheckedChange={(v) =>
                  setModel((m) => ({ ...m, is_published: v }))
                }
              />
              <Label className="!m-0">Published</Label>
            </div>
          </section>

          {/* Inventory + Expiry */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 border rounded-md px-3 py-2">
              <Switch
                checked={model.track_inventory}
                onCheckedChange={(v) =>
                  setModel((m) => ({ ...m, track_inventory: v }))
                }
              />
              <div>
                <div className="text-sm font-medium">Track inventory</div>
                <div className="text-xs text-muted-foreground">
                  If off, stock won’t block checkout.
                </div>
              </div>
            </div>

            <div>
              <Label>Stock qty</Label>
              <Input
                type="number"
                value={model.stock_qty}
                readOnly
                disabled
                className="bg-muted/50"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Auto-calculated from inventory (IN-STOCK units). Add or sell units
                to change it — 0 shows as out of stock on the storefront.
              </p>
            </div>

            <div>
              <Label>Expiry date</Label>
              <Input
                type="date"
                value={model.expiry_date || ""}
                onChange={(e) =>
                  setModel((m) => ({ ...m, expiry_date: e.target.value }))
                }
              />
            </div>
          </section>

          {/* Badges */}
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ["made_in_korea", "Made in Korea"],
              ["is_vegetarian", "Vegetarian"],
              ["cruelty_free", "Cruelty-free"],
              ["toxin_free", "Toxin-free"],
              ["paraben_free", "Paraben-free"],
            ].map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-3 border rounded-md px-3 py-2"
              >
                <Switch
                  checked={(model as any)[key]}
                  onCheckedChange={(v) =>
                    setModel((m) => ({ ...m, [key]: v }) as any)
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </section>

          {/* SEO / Rich */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Meta title</Label>
              <Input
                value={model.meta_title}
                onChange={(e) =>
                  setModel((m) => ({ ...m, meta_title: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Meta description</Label>
              <Textarea
                rows={3}
                value={model.meta_description}
                onChange={(e) =>
                  setModel((m) => ({ ...m, meta_description: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Ingredients (markdown)</Label>
              <Textarea
                rows={4}
                value={model.ingredients_md}
                onChange={(e) =>
                  setModel((m) => ({ ...m, ingredients_md: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Key features (markdown)</Label>
              <Textarea
                rows={4}
                value={model.key_features_md}
                onChange={(e) =>
                  setModel((m) => ({ ...m, key_features_md: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Additional details (markdown)</Label>
              <Textarea
                rows={4}
                value={model.additional_details_md}
                onChange={(e) =>
                  setModel((m) => ({
                    ...m,
                    additional_details_md: e.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>Attributes (JSON)</Label>
              <Textarea
                rows={4}
                value={model.attributes_json}
                onChange={(e) =>
                  setModel((m) => ({ ...m, attributes_json: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>FAQ (Q::A pairs, separated by ||)</Label>
              <Textarea
                rows={3}
                value={model.faq_text}
                onChange={(e) =>
                  setModel((m) => ({ ...m, faq_text: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Key benefits (separate with |)</Label>
              <Input
                value={model.key_benefits_text}
                onChange={(e) =>
                  setModel((m) => ({ ...m, key_benefits_text: e.target.value }))
                }
              />
            </div>
          </section>

          {/* Misc */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Volume (ml)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={model.volume_ml ?? ""}
                onChange={(e) =>
                  setModel((m) => ({
                    ...m,
                    volume_ml: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
            </div>
            <div>
              <Label>Net weight (g)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={model.net_weight_g ?? ""}
                onChange={(e) =>
                  setModel((m) => ({
                    ...m,
                    net_weight_g: e.target.value
                      ? Number(e.target.value)
                      : null,
                  }))
                }
              />
            </div>
            <div>
              <Label>Country of origin</Label>
              <Input
                value={model.country_of_origin}
                onChange={(e) =>
                  setModel((m) => ({ ...m, country_of_origin: e.target.value }))
                }
              />
            </div>
          </section>

          {/* Media */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Images (up to 5)</h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={overwriteStorage}
                    onCheckedChange={setOverwriteStorage}
                  />
                  <span>Overwrite storage files</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={deleteMediaFromStorage}
                    onCheckedChange={setDeleteMediaFromStorage}
                  />
                  <span>Delete files from storage on remove</span>
                </label>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {model.images.map((row, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 ${row.remove ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">Image #{idx + 1}</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeImageSlot(idx)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="mb-2">
                    {row.file ? (
                      <div className="text-xs text-muted-foreground">
                        {row.file.name}
                      </div>
                    ) : row.storage_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={publicUrls[idx]}
                        alt=""
                        className="h-24 w-24 object-cover rounded border"
                      />
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No file selected
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <Label>Choose image</Label>
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setModel((m) => {
                            const copy = [...m.images];
                            copy[idx] = {
                              ...copy[idx],
                              file: f,
                              storage_path: undefined,
                            };
                            return { ...m, images: copy };
                          });
                        }}
                      />
                    </div>

                    <div>
                      <Label>ALT text</Label>
                      <Input
                        value={row.alt}
                        onChange={(e) =>
                          setModel((m) => {
                            const copy = [...m.images];
                            copy[idx] = { ...copy[idx], alt: e.target.value };
                            return { ...m, images: copy };
                          })
                        }
                      />
                    </div>

                    <div>
                      <Label>Sort order</Label>
                      <Input
                        type="number"
                        min="0"
                        value={row.sort_order}
                        onChange={(e) =>
                          setModel((m) => {
                            const v = Number(e.target.value) || 0;
                            const copy = [...m.images];
                            copy[idx] = { ...copy[idx], sort_order: v };
                            return { ...m, images: copy };
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {model.images.filter((x) => !x.remove).length < 5 && (
              <Button variant="outline" onClick={addImageSlot}>
                <Plus className="h-4 w-4 mr-2" /> Add Image
              </Button>
            )}

            <div className="pt-2">
              <h3 className="text-lg font-medium mb-2">Video (optional)</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Choose video</Label>
                  <Input
                    type="file"
                    accept="video/mp4,video/webm"
                    onChange={(e) =>
                      setModel((m) => ({
                        ...m,
                        video_file: e.target.files?.[0] || null,
                        remove_video: false,
                      }))
                    }
                  />
                  {model.video_path && !model.video_file && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Existing: {model.video_path}
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-3 mt-6">
                  <Switch
                    checked={!!model.remove_video}
                    onCheckedChange={(v) =>
                      setModel((m) => ({
                        ...m,
                        remove_video: v,
                        video_file: v ? null : m.video_file,
                      }))
                    }
                  />
                  <span>Remove existing video</span>
                </label>
              </div>
            </div>
          </section>

          {/* Save buttons */}
          <div className="flex gap-2">
            <Button onClick={() => onSave(false)} disabled={busy || !canSave}>
              <Upload className="h-4 w-4 mr-2" /> Save
            </Button>
            <Button
              variant="secondary"
              onClick={() => onSave(true)}
              disabled={busy || !canSave}
            >
              Save & Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
