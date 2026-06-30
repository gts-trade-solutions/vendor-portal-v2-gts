"use client";

import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { uploadMedia } from "@/lib/storage/upload-client";

const MEDIA_BUCKET = "product-media";

/* ──────────────────────────────────────────────────────────────
   Types
   ────────────────────────────────────────────────────────────── */

type BulkProductRow = {
  sku: string | null;
  slug: string;
  name: string;
  brand_slug: string | null;
  category_slug: string | null;
  price: number | null;
  currency: string | null;
  short_description: string | null;
  description: string | null;

  // images come from image1..image5 columns
  hero_image_filename: null;
  og_image_filename: null;

  // vendor-controlled
  is_published: boolean;
  compare_at_price: number | null;
  sale_price: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;

  // badges
  made_in_korea: boolean;
  is_vegetarian: boolean;
  cruelty_free: boolean;
  toxin_free: boolean;
  paraben_free: boolean;

  // SEO / rich
  meta_title: string | null;
  meta_description: string | null;
  ingredients_md: string | null;
  key_features_md: string | null;
  additional_details_md: string | null;
  attributes_json: string | null;
  faq: Array<{ q: string; a: string }>;
  key_benefits: string[];

  // misc
  volume_ml: number | null;
  net_weight_g: number | null;
  country_of_origin: string | null;
};

type BulkMediaRow = {
  sku: string | null;
  filename: string;
  alt: string | null;
  sort_order: number | null;
};

type BulkVideoRow = {
  sku: string | null;
  filename: string;
  alt: string | null;
};

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */
const IMAGE_MAX_MB = 5;
const VIDEO_MAX_MB = 50;
const MAX_IMAGES_PER_PRODUCT = 5;

function skuify(s: string): string {
  // Uppercase, keep A–Z/0–9, collapse to hyphens
  return s
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40); // keep tidy
}

function makeUniqueSku(base: string, used: Set<string>): string {
  let sku = base || "SKU";
  if (!used.has(sku)) {
    used.add(sku);
    return sku;
  }
  let k = 2;
  while (used.has(`${sku}-${k}`)) k++;
  const uniq = `${sku}-${k}`;
  used.add(uniq);
  return uniq;
}

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function toNumOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function parseBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "y"].includes(s);
}
function toISODate(v: any): string | null {
  if (!v && v !== 0) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const dt = new Date(
      Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, d.S || 0)
    );
    return dt.toISOString();
  }
  const date = new Date(v);
  return isNaN(+date) ? null : date.toISOString();
}
function safeJSON(raw: any): any {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}
function parseList(v: any): string[] {
  if (!v) return [];
  return String(v)
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function parseFaq(v: any): Array<{ q: string; a: string }> {
  if (!v) return [];
  return String(v)
    .split("||")
    .map((pair) => {
      const [q, a] = pair.split("::").map((s) => (s ?? "").trim());
      if (!q && !a) return null;
      return { q: q || "", a: a || "" };
    })
    .filter(Boolean) as Array<{ q: string; a: string }>;
}
function safeKeyPart(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
async function mapLimit<T, R>(
  arr: T[],
  limit: number,
  fn: (v: T, i: number) => Promise<R>
): Promise<R[]> {
  const ret: R[] = new Array(arr.length);
  let next = 0;
  const workers = Array(Math.min(limit, arr.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = next++;
        if (i >= arr.length) break;
        ret[i] = await fn(arr[i], i);
      }
    });
  await Promise.all(workers);
  return ret;
}

function isImage(f: File) {
  return f.type.startsWith("image/");
}
function isVideo(f: File) {
  return f.type.startsWith("video/");
}
function withinSize(f: File) {
  const mb = f.size / (1024 * 1024);
  if (isImage(f)) return mb <= IMAGE_MAX_MB;
  if (isVideo(f)) return mb <= VIDEO_MAX_MB;
  return false;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function makeUniqueSlug(base: string, used: Set<string>): string {
  let slug = base;
  let k = 2;
  while (used.has(slug)) slug = `${base}-${k++}`;
  used.add(slug);
  return slug;
}

function downloadBlob(
  buf: ArrayBuffer,
  filename: string,
  mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
) {
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ──────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────── */
export function ProductForm() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [bulkChosenFiles, setBulkChosenFiles] = useState<File[]>([]);
  const [bulkProducts, setBulkProducts] = useState<BulkProductRow[]>([]);
  const [bulkMedia, setBulkMedia] = useState<BulkMediaRow[]>([]);
  const [bulkVideos, setBulkVideos] = useState<BulkVideoRow[]>([]);

  const [bulkOverwriteImages, setBulkOverwriteImages] = useState(false);
  const [bulkReplaceImages, setBulkReplaceImages] = useState(false);
  const [bulkValidated, setBulkValidated] = useState(false);
  const [bulkIssues, setBulkIssues] = useState<string[]>([]);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  const chosenNames = useMemo(
    () => new Set(bulkChosenFiles.map((f) => f.name.toLowerCase())),
    [bulkChosenFiles]
  );

  /* ── Template (single sheet) ── */
// npm i exceljs
async function bulkDownloadTemplate() {
  const [brandsRes, catsRes] = await Promise.all([
    fetch("/api/vendor/brands", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    fetch("/api/vendor/categories", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
  ]);
  const brandSlugs = ((brandsRes?.data ?? []) as any[]).map((b) => b.slug).filter(Boolean);
  const categorySlugs = ((catsRes?.data ?? []) as any[]).map((c) => c.slug).filter(Boolean);

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  // Hidden lookup sheets (A column lists slugs)
  const wsBrands = wb.addWorksheet("brands", { state: "veryHidden" });
  const wsCats   = wb.addWorksheet("categories", { state: "veryHidden" });
  (brandSlugs.length ? brandSlugs : ["brand-slug"]).forEach((s, i) => wsBrands.getCell(i + 1, 1).value = s);
  (categorySlugs.length ? categorySlugs : ["category-slug"]).forEach((s, i) => wsCats.getCell(i + 1, 1).value = s);

  const lastBrand = Math.max(1, brandSlugs.length);
  const lastCat   = Math.max(1, categorySlugs.length);
  const brandRange = `'brands'!$A$1:$A$${lastBrand}`;
  const catRange   = `'categories'!$A$1:$A$${lastCat}`;

  // Main sheet — define columns FIRST
  const ws = wb.addWorksheet("Products");
  ws.columns = [
    { header: "sku", key: "sku", width: 18 },
    { header: "slug", key: "slug", width: 26 },
    { header: "name", key: "name", width: 34 },
    { header: "brand_slug", key: "brand_slug", width: 22 },
    { header: "category_slug", key: "category_slug", width: 24 },
    { header: "price", key: "price", width: 12 },
    { header: "currency", key: "currency", width: 10 },
    { header: "short_description", key: "short_description", width: 40 },
    { header: "description", key: "description", width: 50 },

    { header: "image1_filename", key: "image1_filename", width: 22 },
    { header: "image1_alt", key: "image1_alt", width: 22 },
    { header: "image1_sort", key: "image1_sort", width: 12 },

    { header: "image2_filename", key: "image2_filename", width: 22 },
    { header: "image2_alt", key: "image2_alt", width: 22 },
    { header: "image2_sort", key: "image2_sort", width: 12 },

    { header: "image3_filename", key: "image3_filename", width: 22 },
    { header: "image3_alt", key: "image3_alt", width: 22 },
    { header: "image3_sort", key: "image3_sort", width: 12 },

    { header: "image4_filename", key: "image4_filename", width: 22 },
    { header: "image4_alt", key: "image4_alt", width: 22 },
    { header: "image4_sort", key: "image4_sort", width: 12 },

    { header: "image5_filename", key: "image5_filename", width: 22 },
    { header: "image5_alt", key: "image5_alt", width: 22 },
    { header: "image5_sort", key: "image5_sort", width: 12 },

    { header: "video_filename", key: "video_filename", width: 22 },
    { header: "video_alt", key: "video_alt", width: 22 },

    { header: "is_published", key: "is_published", width: 12 },
    { header: "compare_at_price", key: "compare_at_price", width: 16 },
    { header: "sale_price", key: "sale_price", width: 12 },
    { header: "sale_starts_at", key: "sale_starts_at", width: 18 },
    { header: "sale_ends_at", key: "sale_ends_at", width: 18 },

    { header: "made_in_korea", key: "made_in_korea", width: 14 },
    { header: "is_vegetarian", key: "is_vegetarian", width: 14 },
    { header: "cruelty_free", key: "cruelty_free", width: 12 },
    { header: "toxin_free", key: "toxin_free", width: 12 },
    { header: "paraben_free", key: "paraben_free", width: 12 },

    { header: "meta_title", key: "meta_title", width: 28 },
    { header: "meta_description", key: "meta_description", width: 40 },
    { header: "ingredients_md", key: "ingredients_md", width: 40 },
    { header: "key_features_md", key: "key_features_md", width: 40 },
    { header: "additional_details_md", key: "additional_details_md", width: 40 },
    { header: "attributes_json", key: "attributes_json", width: 28 },
    { header: "faq", key: "faq", width: 34 },
    { header: "key_benefits", key: "key_benefits", width: 28 },

    { header: "volume_ml", key: "volume_ml", width: 12 },
    { header: "net_weight_g", key: "net_weight_g", width: 12 },
    { header: "country_of_origin", key: "country_of_origin", width: 16 },
  ];
  ws.views = [{ state: "frozen", ySplit: 1 }];

  // Helper: write a row by keys (prevents any addRow issues)
  const keys = ws.columns.map(c => String(c.key));
  function writeRow(rowIndex: number, obj: Record<string, any>) {
    keys.forEach((k, i) => {
      const v = Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : "";
      ws.getCell(rowIndex, i + 1).value = v === undefined ? "" : v;
    });
  }

  // Sample rows (write BEFORE validation)
  const ex1 = {
    sku: "ABC-001",
    slug: "",
    name: "Example Product",
    brand_slug: brandSlugs[0] ?? "brand-slug",
    category_slug: categorySlugs[0] ?? "category-slug",
    price: 999, currency: "INR",
    short_description: "Short one-liner.",
    description: "Long description…",
    image1_filename: "hero.jpg",  image1_alt: "Front",  image1_sort: 0,
    image2_filename: "angle.jpg", image2_alt: "Angle",  image2_sort: 1,
    image3_filename: "", image3_alt: "", image3_sort: "",
    image4_filename: "", image4_alt: "", image4_sort: "",
    image5_filename: "", image5_alt: "", image5_sort: "",
    video_filename: "demo.mp4",   video_alt: "30s demo",
    is_published: true, compare_at_price: "", sale_price: "",
    sale_starts_at: "", sale_ends_at: "",
    made_in_korea: true, is_vegetarian: true, cruelty_free: true, toxin_free: true, paraben_free: true,
    meta_title: "SEO Title", meta_description: "SEO description…",
    ingredients_md: "- Water\n- Glycerin",
    key_features_md: "- Feature A\n- Feature B",
    additional_details_md: "",
    attributes_json: "{\"shade\":\"01\",\"size\":\"100ml\"}",
    faq: "Q1?::A1||Q2?::A2",
    key_benefits: "Hydrating|Brightening|Soothing",
    volume_ml: 100, net_weight_g: "", country_of_origin: "Korea",
  };

  writeRow(2, ex1);

  // Wrap long text columns
  ["short_description","description","ingredients_md","key_features_md","additional_details_md","meta_description"]
    .forEach(key => { ws.getColumn(key).alignment = { wrapText: true }; });

  // Data validation (after rows are written). Use direct ranges, NO "=".
  for (let r = 2; r <= 5000; r++) {
    ws.getCell(`D${r}`).dataValidation = {
      type: "list", allowBlank: true, formulae: [brandRange],
      showErrorMessage: true, errorStyle: "warning",
      errorTitle: "Invalid brand", error: "Pick a brand from the list.",
    };
    ws.getCell(`E${r}`).dataValidation = {
      type: "list", allowBlank: true, formulae: [catRange],
      showErrorMessage: true, errorStyle: "warning",
      errorTitle: "Invalid category", error: "Pick a category from the list.",
    };
  }

  // Download
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "bulk_products_template.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}






  /* ── Parse Excel (single sheet) ── */
  async function bulkOnExcelChosen(file: File) {
    setBulkIssues([]);
    setBulkProgress(0);

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets["Products"] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      setBulkIssues(["No 'Products' sheet found"]);
      return;
    }

    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const products: BulkProductRow[] = [];
    const media: BulkMediaRow[] = [];
    const videos: BulkVideoRow[] = [];

    // Track uniqueness inside this sheet
    const usedSlugs = new Set<string>();
    const usedSkus = new Set<string>();
    const autoSkuRowIdx: number[] = []; // rows where SKU was auto-generated

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const name = (r.name || "").trim();

      // ---- SKU: generate when blank, unique within the sheet ----
      let sku = (r.sku || "").trim();
      let autoSku = false;
      if (!sku) {
        const seed = (r.slug || "").trim() || name || `PRODUCT-${i + 2}`;
        const base = skuify(seed);
        sku = makeUniqueSku(base, usedSkus);
        autoSku = true;
      } else {
        const fixed = skuify(sku);
        sku = makeUniqueSku(fixed, usedSkus);
      }
      if (autoSku) autoSkuRowIdx.push(i);

      // ---- SLUG: generate when blank (prefer SKU), unique within the sheet ----
      let rawSlug = (r.slug || "").trim();
      if (!rawSlug) {
        const base = slugify(sku || name || `product-${i + 2}`);
        rawSlug = makeUniqueSlug(base, usedSlugs);
      } else {
        rawSlug = makeUniqueSlug(slugify(rawSlug), usedSlugs);
      }

      const p: BulkProductRow = {
        sku,
        slug: rawSlug,
        name,
        brand_slug: (r.brand_slug || "").trim() || null,
        category_slug: (r.category_slug || "").trim() || null,
        price: toNumOrNull(r.price),
        currency: r.currency || null,
        short_description: r.short_description || null,
        description: r.description || null,

        // legacy hero/og not used in sheet
        hero_image_filename: null,
        og_image_filename: null,

        is_published: parseBool(r.is_published),
        compare_at_price: toNumOrNull(r.compare_at_price),
        sale_price: toNumOrNull(r.sale_price),
        sale_starts_at: toISODate(r.sale_starts_at),
        sale_ends_at: toISODate(r.sale_ends_at),

        made_in_korea: parseBool(r.made_in_korea),
        is_vegetarian: parseBool(r.is_vegetarian),
        cruelty_free: parseBool(r.cruelty_free),
        toxin_free: parseBool(r.toxin_free),
        paraben_free: parseBool(r.paraben_free),

        meta_title: r.meta_title || null,
        meta_description: r.meta_description || null,
        ingredients_md: r.ingredients_md || null,
        key_features_md: r.key_features_md || null,
        additional_details_md: r.additional_details_md || null,
        attributes_json: r.attributes_json || null,
        faq: parseFaq(r.faq),
        key_benefits: parseList(r.key_benefits),

        volume_ml: toNumOrNull(r.volume_ml),
        net_weight_g: toNumOrNull(r.net_weight_g),
        country_of_origin: r.country_of_origin || null,
      };

      // images 1..5 (ALT fallback uses product name; “– View N” for subsequent)
      let added = 0;
      for (let idx = 1; idx <= 5; idx++) {
        const fn = (r[`image${idx}_filename`] || "").trim();
        const altRaw = (r[`image${idx}_alt`] || "").trim();
        const srt = r[`image${idx}_sort`];
        if (!fn) continue;
        const sort = srt === "" || srt == null ? idx - 1 : toInt(srt);
        const alt =
          altRaw ||
          (name ? `${name}${added ? ` – View ${added + 1}` : ""}` : null);
        added += 1;
        media.push({
          sku: p.sku,
          filename: fn,
          alt,
          sort_order: Number.isFinite(sort as number)
            ? (sort as number)
            : idx - 1,
        });
      }

      // single video (ALT fallback)
      const vf = (r.video_filename || "").trim();
      const va = (r.video_alt || "").trim();
      if (vf)
        videos.push({
          sku: p.sku,
          filename: vf,
          alt: va || (name ? `${name} – Video` : null),
        });

      if (p.slug || p.sku || p.name) products.push(p);

      if (i % 25 === 0) {
        setBulkProgress(Math.round(((i + 1) / Math.max(1, rows.length)) * 40));
      }
    }

    // ---- OPTIONAL: avoid DB SKU collisions for ONLY auto-generated SKUs ----
    if (autoSkuRowIdx.length) {
      const genSkus = autoSkuRowIdx
        .map((ri) => products[ri].sku!)
        .filter(Boolean);
      let usedDbSkus: any[] = [];
      try {
        const res = await fetch(
          `/api/vendor/products?mode=sku-check&skus=${encodeURIComponent(genSkus.join(","))}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (res.ok && body?.ok) usedDbSkus = body.data ?? [];
      } catch {
        usedDbSkus = [];
      }

      if (usedDbSkus.length) {
        const dbSet = new Set<string>(
          usedDbSkus.map((x: any) => (x.sku as string).toUpperCase())
        );
        for (const ri of autoSkuRowIdx) {
          let s = products[ri].sku!;
          if (!dbSet.has(s)) continue;
          // bump suffix until not in sheet-used or DB
          let k = 2,
            next = `${s}-${k}`;
          while (usedSkus.has(next) || dbSet.has(next)) next = `${s}-${++k}`;
          // reserve new SKU & update product
          usedSkus.add(next);
          products[ri].sku = next;
        }
      }
    }

    setBulkProducts(products);
    setBulkMedia(media);
    setBulkVideos(videos);
    setExcelFile(file);
    setBulkProgress(40);
  }

  /* ── Choose files (images + video) ── */
  async function bulkOnMediaChosen(files: FileList | File[]) {
    const next = [...bulkChosenFiles];
    const issues: string[] = [];

    for (const f of Array.from(files)) {
      if (!isImage(f) && !isVideo(f)) {
        issues.push(`Unsupported type: ${f.name} (${f.type || "unknown"})`);
        continue;
      }
      if (!withinSize(f)) {
        issues.push(
          `Too large: ${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB). ` +
            `Max image ${IMAGE_MAX_MB}MB, video ${VIDEO_MAX_MB}MB.`
        );
        continue;
      }
      if (next.some((x) => x.name.toLowerCase() === f.name.toLowerCase()))
        continue;
      next.push(f);
    }

    setBulkChosenFiles(next);
    if (issues.length) setBulkIssues((prev) => [...prev, ...issues]);
  }

  /* ── Validate (no auth checks) ── */
  async function bulkValidateAll(): Promise<boolean> {
    const issues: string[] = [];

    for (const p of bulkProducts) {
      const label = p.slug || p.sku || p.name || "(unnamed)";
      if (!p.sku) issues.push(`'${label}': sku is required`);
      if (!p.slug) issues.push(`'${label}': slug is required`);
      if (!p.name) issues.push(`'${label}': name is required`);
      if (!p.brand_slug) issues.push(`'${label}': brand_slug is required`);
      if (!p.category_slug)
        issues.push(`'${label}': category_slug is required`);
    }

    const [brandRes, catRes] = await Promise.all([
      fetch("/api/vendor/brands", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/vendor/categories", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    const brandSet = new Set(((brandRes?.data ?? []) as any[]).map((b: any) => b.slug));
    const catSet = new Set(((catRes?.data ?? []) as any[]).map((c: any) => c.slug));

    for (const p of bulkProducts) {
      const label = p.slug || p.sku || p.name || "(unnamed)";
      if (p.brand_slug && !brandSet.has(p.brand_slug)) {
        issues.push(`'${label}': unknown brand_slug '${p.brand_slug}'`);
      }
      if (p.category_slug && !catSet.has(p.category_slug)) {
        issues.push(`'${label}': unknown category_slug '${p.category_slug}'`);
      }
    }

    const imgsBySku = new Map<string, BulkMediaRow[]>();
    for (const m of bulkMedia) {
      if (!m.sku || !m.filename) continue;
      const arr = imgsBySku.get(m.sku) ?? [];
      arr.push(m);
      imgsBySku.set(m.sku, arr);
    }
    const vidBySku = new Map<string, BulkVideoRow>();
    for (const v of bulkVideos) {
      if (v.sku && v.filename) vidBySku.set(v.sku, v);
    }

    for (const p of bulkProducts) {
      const label = p.slug || p.sku || p.name || "(unnamed)";
      const imgs = imgsBySku.get(p.sku || "") || [];
      if (imgs.length > MAX_IMAGES_PER_PRODUCT) {
        issues.push(`'${label}': more than ${MAX_IMAGES_PER_PRODUCT} images`);
      }
      for (const m of imgs) {
        const need = m.filename.toLowerCase();
        if (!chosenNames.has(need)) {
          issues.push(`'${label}': image file not selected → ${need}`);
        }
      }
      const v = vidBySku.get(p.sku || "");
      if (v) {
        const need = v.filename.toLowerCase();
        if (!chosenNames.has(need)) {
          issues.push(`'${label}': video file not selected → ${need}`);
        }
      }
      if (
        p.sale_price != null &&
        p.compare_at_price != null &&
        p.sale_price >= p.compare_at_price
      ) {
        issues.push(`'${label}': sale_price must be < compare_at_price`);
      }
      if (
        p.sale_starts_at &&
        p.sale_ends_at &&
        p.sale_starts_at > p.sale_ends_at
      ) {
        issues.push(`'${label}': sale_starts_at must be <= sale_ends_at`);
      }
    }

    setBulkIssues(issues);
    const ok = issues.length === 0;
    setBulkValidated(ok);
    return ok;
  }

  /* ── Upload assets ── */
  async function bulkUploadAssets() {
    const tasks: { key: string; file: File }[] = [];
    const chosen = new Map(
      bulkChosenFiles.map((f) => [f.name.toLowerCase(), f])
    );

    for (const m of bulkMedia) {
      const f = chosen.get(m.filename.toLowerCase());
      if (!f) continue;
      const key = `${safeKeyPart(m.sku || "")}/${safeKeyPart(f.name)}`;
      tasks.push({ key, file: f });
    }
    for (const v of bulkVideos) {
      const f = chosen.get(v.filename.toLowerCase());
      if (!f) continue;
      const key = `${safeKeyPart(v.sku || "")}/video/${safeKeyPart(f.name)}`;
      tasks.push({ key, file: f });
    }

    if (!tasks.length) return;

    let done = 0;
    const limit = 3;
    await mapLimit(tasks, limit, async ({ key, file }) => {
      try {
        await uploadMedia(MEDIA_BUCKET, key, file, { upsert: bulkOverwriteImages });
      } catch (e: any) {
        throw new Error(`${key}: ${e?.message || "upload failed"}`);
      }
      done += 1;
      setBulkProgress(40 + Math.round((done / tasks.length) * 40)); // 40→80
    });
  }

  /* ── Upsert DB (products + product_images + video_path) ── */
  function videoPathForSku(sku: string | null): string | null {
    if (!sku) return null;
    const v = bulkVideos.find((x) => x.sku === sku && x.filename);
    return v ? `${safeKeyPart(sku)}/video/${safeKeyPart(v.filename)}` : null;
  }

  // Vendor-scoped server upsert (products + product_images + hero/og + video_path).
  // The slug->id resolution, hero/og computation and image upserts now run inside
  // /api/vendor/products/bulk-upsert (Prisma, transactional, vendor-scoped).
  async function bulkUpsertAll(): Promise<{ ok: boolean; issues: string[] }> {
    let issues: string[] = [];
    setBulkIssues([]);
    setBulkProgress(80);

    try {
      const res = await fetch("/api/vendor/products/bulk-upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          products: bulkProducts,
          media: bulkMedia,
          videos: bulkVideos,
          replaceImages: bulkReplaceImages,
        }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        issues = [body?.error || "Upsert request failed"];
      } else {
        issues = Array.isArray(body?.issues) ? body.issues : [];
      }
    } catch (e: any) {
      issues = [`Unexpected error: ${e?.message || String(e)}`];
    }

    setBulkIssues(issues);
    setBulkProgress(100);
    return { ok: issues.length === 0, issues };
  }

  /* ── Orchestration ── */
  async function bulkRunAll() {
    if (!excelFile) {
      setBulkIssues(["Please select an Excel file first."]);
      return;
    }
    setBusy(true);
    setBulkIssues([]);
    setBulkProgress(0);
    try {
      const ok = await bulkValidateAll();
      if (!ok) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      await bulkUploadAssets();
      await bulkUpsertAll();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setBulkIssues((prev) => [...prev, e?.message || "Unexpected error"]);
    } finally {
      setBusy(false);
    }
  }

  /* ── UI (Tailwind-styled) ── */
  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Bulk Upload — Products
          </h1>
          <p className="text-sm text-muted-foreground">
            Single sheet. Up to <span className="font-medium">5 images</span>{" "}
            and <span className="font-medium">1 video</span> per product (all
            optional).
          </p>
        </div>
        <div className="hidden sm:flex gap-2">
          <button
            onClick={bulkDownloadTemplate}
            disabled={busy}
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-white shadow hover:opacity-90 disabled:opacity-50"
          >
            Download Template
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Excel */}
        <section className="rounded-xl border bg-card shadow-sm">
          <div className="border-b p-4">
            <h2 className="text-lg font-medium">1) Upload Excel</h2>
            <p className="text-xs text-muted-foreground">
              Sheet name: <code>Products</code>
            </p>
          </div>
          <div className="p-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Excel file (.xlsx)
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setExcelFile(f);
                    bulkOnExcelChosen(f);
                  }
                }}
                disabled={busy}
                className="block w-full cursor-pointer rounded-lg border bg-background px-3 py-2 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:opacity-90"
              />
            </label>

            <div className="text-xs text-muted-foreground">
              Parsed: <span className="font-medium">{bulkProducts.length}</span>{" "}
              products,&nbsp;
              <span className="font-medium">{bulkMedia.length}</span>{" "}
              images,&nbsp;
              <span className="font-medium">{bulkVideos.length}</span> videos
            </div>

            <button
              onClick={bulkDownloadTemplate}
              disabled={busy}
              className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted/50 md:hidden"
            >
              Download Template
            </button>
          </div>
        </section>

        {/* Media */}
        <section className="rounded-xl border bg-card shadow-sm">
          <div className="border-b p-4">
            <h2 className="text-lg font-medium">2) Select Media Files</h2>
            <p className="text-xs text-muted-foreground">
              Images ≤ {IMAGE_MAX_MB}MB each, Video ≤ {VIDEO_MAX_MB}MB
            </p>
          </div>
          <div className="p-4 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Images &amp; Video
              </span>
              <input
                type="file"
                multiple
                accept="image/*,video/mp4,video/webm"
                onChange={(e) =>
                  e.target.files && bulkOnMediaChosen(e.target.files)
                }
                disabled={busy}
                className="block w-full cursor-pointer rounded-lg border bg-background px-3 py-2 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:opacity-90"
              />
            </label>

            <div className="rounded-md border bg-muted/40 p-3 text-xs">
              <div className="mb-1 font-medium">Selected files</div>
              <div className="text-muted-foreground">
                {bulkChosenFiles.length ? (
                  <span>{bulkChosenFiles.length} file(s) selected.</span>
                ) : (
                  <span>None selected yet.</span>
                )}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={bulkOverwriteImages}
                  onChange={(e) => setBulkOverwriteImages(e.target.checked)}
                  disabled={busy}
                />
                Overwrite same filenames in storage
              </label>
              <label className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={bulkReplaceImages}
                  onChange={(e) => setBulkReplaceImages(e.target.checked)}
                  disabled={busy}
                />
                Replace existing product images
              </label>
            </div>
          </div>
        </section>

        {/* Validate & Import */}
        <section className="md:col-span-2 rounded-xl border bg-card shadow-sm">
          <div className="border-b p-4">
            <h2 className="text-lg font-medium">3) Validate &amp; Import</h2>
            <p className="text-xs text-muted-foreground">
              Validate first, then Upload, then Upsert. Or use “Run All”.
            </p>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={bulkValidateAll}
                disabled={busy}
                className="inline-flex items-center rounded-lg bg-secondary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Validate
              </button>
              <button
                onClick={bulkUploadAssets}
                disabled={busy || !bulkValidated}
                className="inline-flex items-center rounded-lg bg-secondary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Upload Files
              </button>
              <button
                onClick={bulkUpsertAll}
                disabled={busy || !bulkValidated}
                className="inline-flex items-center rounded-lg bg-secondary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Upsert to DB
              </button>
              <button
                onClick={bulkRunAll}
                disabled={busy}
                className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow hover:opacity-90 disabled:opacity-50"
              >
                Run All
              </button>
            </div>

            {/* Progress */}
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${bulkProgress}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Progress: {bulkProgress}%
              </div>
            </div>

            {/* Issues */}
            {bulkIssues.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="mb-2 text-sm font-medium text-destructive">
                  Issues ({bulkIssues.length})
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {bulkIssues.map((s, i) => (
                    <li key={i} className="text-destructive">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
