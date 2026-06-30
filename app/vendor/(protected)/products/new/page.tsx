"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Download,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useVendorRole } from "@/lib/hooks/useVendorRole";

// Columns the importer understands (match the bulk-upsert payload contract).
const IMPORT_COLUMNS = [
  "name",
  "slug",
  "sku",
  "hsn",
  "brand",
  "category",
  "price",
  "purchase_price",
  "compare_at_price",
  "sale_price",
  "currency",
  "short_description",
  "description",
  "is_published",
] as const;

type CatalogItem = { id: string; name: string; slug: string };

type ParsedRow = {
  // raw importable cells (already normalized keys)
  raw: Record<string, any>;
  // resolved bulk-upsert payload shape (when valid)
  payload: BulkProductRow | null;
  errors: string[];
  selected: boolean;
};

// The exact shape /api/vendor/products/bulk-upsert consumes per product.
type BulkProductRow = {
  name: string;
  slug: string;
  sku: string | null;
  hsn: string | null;
  brand_slug: string | null;
  category_slug: string | null;
  price: number | null;
  purchase_price: number | null;
  compare_at_price: number | null;
  sale_price: number | null;
  currency: string;
  short_description: string | null;
  description: string | null;
  is_published: boolean;
};

function slugify(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[, ]+/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "published";
}

export default function ImportProductsPage() {
  const router = useRouter();
  const { isAdmin, loading: roleLoading } = useVendorRole();
  const fileRef = useRef<HTMLInputElement>(null);

  const [brands, setBrands] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<CatalogItem[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);

  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);

  // Load brand/category catalogs for name -> slug resolution.
  useEffect(() => {
    (async () => {
      try {
        const [bRes, cRes] = await Promise.all([
          fetch("/api/vendor/brands", { cache: "no-store" }),
          fetch("/api/vendor/categories", { cache: "no-store" }),
        ]);
        const bBody = await bRes.json();
        const cBody = await cRes.json();
        setBrands(
          ((bBody?.data ?? []) as any[]).map((b) => ({
            id: b.id,
            name: b.name,
            slug: b.slug,
          }))
        );
        setCategories(
          ((cBody?.data ?? []) as any[]).map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
          }))
        );
      } catch (e) {
        toast.error("Failed to load brand/category catalog");
      } finally {
        setCatalogReady(true);
      }
    })();
  }, []);

  // case-insensitive name -> slug maps (also allow matching by slug directly)
  const brandBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of brands) {
      m.set(b.name.trim().toLowerCase(), b.slug);
      if (b.slug) m.set(b.slug.trim().toLowerCase(), b.slug);
    }
    return m;
  }, [brands]);

  const categoryBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) {
      m.set(c.name.trim().toLowerCase(), c.slug);
      if (c.slug) m.set(c.slug.trim().toLowerCase(), c.slug);
    }
    return m;
  }, [categories]);

  // ---------------- template download ----------------
  const downloadTemplate = () => {
    const header = [...IMPORT_COLUMNS];
    const example = [
      "Glow Serum 30ml", // name*
      "", // slug (auto from name if blank)
      "GLOW-SERUM-30", // sku
      "3304", // hsn
      "Some Brand", // brand (must match an existing brand name)
      "Skincare", // category* (must match an existing category name)
      "1299", // price
      "700", // purchase_price
      "1599", // compare_at_price
      "999", // sale_price
      "INR", // currency
      "Brightening vitamin C serum", // short_description
      "Full long description here", // description
      "true", // is_published
    ];
    const notes = [
      "name and category are REQUIRED. brand/category must match existing names (case-insensitive).",
      "leave slug blank to auto-generate from name",
      "",
      "",
      "",
      "",
      "numbers only",
      "",
      "",
      "",
      "defaults to INR",
      "",
      "",
      "true / false",
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, example, notes]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "product_import_template.xlsx");
  };

  // ---------------- file parse ----------------
  const validateRow = (raw: Record<string, any>): ParsedRow => {
    const errors: string[] = [];

    const name = String(raw.name ?? "").trim();
    if (!name) errors.push("name is required");

    const categoryRaw = String(raw.category ?? "").trim();
    let category_slug: string | null = null;
    if (!categoryRaw) {
      errors.push("category is required");
    } else {
      const found = categoryBySlug.get(categoryRaw.toLowerCase());
      if (!found) errors.push(`unknown category '${categoryRaw}'`);
      else category_slug = found;
    }

    const brandRaw = String(raw.brand ?? "").trim();
    let brand_slug: string | null = null;
    if (brandRaw) {
      const found = brandBySlug.get(brandRaw.toLowerCase());
      if (!found) errors.push(`unknown brand '${brandRaw}'`);
      else brand_slug = found;
    }
    // bulk-upsert requires a brand (rejects rows with no brand_id)
    if (!brand_slug) errors.push("brand is required (must match an existing brand)");

    const slug = String(raw.slug ?? "").trim() || slugify(name);

    const payload: BulkProductRow | null =
      errors.length === 0
        ? {
            name,
            slug,
            sku: String(raw.sku ?? "").trim() || null,
            hsn: String(raw.hsn ?? "").trim() || null,
            brand_slug,
            category_slug,
            price: toNum(raw.price),
            purchase_price: toNum(raw.purchase_price),
            compare_at_price: toNum(raw.compare_at_price),
            sale_price: toNum(raw.sale_price),
            currency: String(raw.currency ?? "").trim() || "INR",
            short_description: String(raw.short_description ?? "").trim() || null,
            description: String(raw.description ?? "").trim() || null,
            is_published: toBool(raw.is_published),
          }
        : null;

    return { raw, payload, errors, selected: errors.length === 0 };
  };

  const reparse = (parsedRaws: Record<string, any>[]) => {
    setRows(parsedRaws.map((r) => validateRow(r)));
  };

  // re-validate when catalogs become available (rows parsed before maps ready)
  useEffect(() => {
    if (!rows.length) return;
    setRows((prev) => prev.map((r) => validateRow(r.raw)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandBySlug, categoryBySlug]);

  const onFile = async (file: File) => {
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        toast.error("No sheet found in file");
        return;
      }
      // header:1 -> array-of-arrays so we can normalize header keys ourselves
      const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, {
        header: 1,
        defval: "",
        blankrows: false,
      });
      if (!aoa.length) {
        toast.error("File is empty");
        return;
      }

      const headerCells = (aoa[0] as any[]).map((h) =>
        String(h ?? "").trim().toLowerCase().replace(/\s+/g, "_")
      );

      const known = new Set<string>(IMPORT_COLUMNS as readonly string[]);
      const dataRows: Record<string, any>[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const cells = aoa[i] as any[];
        const rec: Record<string, any> = {};
        let anyValue = false;
        headerCells.forEach((key, idx) => {
          if (!known.has(key)) return;
          const val = cells?.[idx];
          rec[key] = val;
          if (String(val ?? "").trim() !== "") anyValue = true;
        });
        if (anyValue) dataRows.push(rec);
      }

      if (!dataRows.length) {
        toast.error("No data rows found (only a header?)");
        setRows([]);
        return;
      }

      // Drop a "notes" row if the first data row looks like our template note.
      reparse(dataRows);
      toast.success(`Parsed ${dataRows.length} row(s)`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to parse file");
    }
  };

  const validRows = rows.filter((r) => r.errors.length === 0);
  const selectedValid = rows.filter((r) => r.selected && r.errors.length === 0);

  const toggleRow = (idx: number, checked: boolean) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, selected: checked } : r))
    );
  };

  const toggleAll = (checked: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.errors.length === 0 ? { ...r, selected: checked } : r))
    );
  };

  // ---------------- import ----------------
  const onImport = async () => {
    if (importing) return;
    const products = selectedValid.map((r) => r.payload).filter(Boolean) as BulkProductRow[];
    if (products.length === 0) {
      toast.error("No valid rows selected to import");
      return;
    }

    setImporting(true);
    try {
      const res = await fetch("/api/vendor/products/bulk-upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          products,
          media: [],
          videos: [],
          replaceImages: false,
        }),
      });
      const body = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        toast.error(body?.error || `Import failed (${res.status})`);
        return;
      }

      const issues: string[] = Array.isArray(body?.issues) ? body.issues : [];
      const failed = issues.length;
      const ok = products.length - failed;

      if (body?.ok && failed === 0) {
        toast.success(`Imported ${ok} product(s) successfully`);
        router.push("/vendor/products");
        return;
      }

      // partial: surface the issue strings
      toast.warning(
        `Imported ${ok}/${products.length}. ${failed} failed.`,
        { description: issues.slice(0, 5).join(" • ") }
      );
      // mark failed rows by matching label (slug) where possible
      console.warn("bulk-upsert issues", issues);
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  if (!roleLoading && !isAdmin) {
    return (
      <div className="min-h-screen bg-muted/30">
        <div className="container mx-auto py-16">
          <Card>
            <CardHeader>
              <CardTitle>Import not available</CardTitle>
              <CardDescription>
                Only vendor owners and managers can import products.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => router.push("/vendor/products")}>
                ← Back to products
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/vendor/products")}>
              ← Back
            </Button>
            <h1 className="text-2xl font-bold">Import Products (CSV / XLSX)</h1>
          </div>
        </div>
      </header>

      <div className="container mx-auto py-8 space-y-6">
        {/* Step 1: template + upload */}
        <Card>
          <CardHeader>
            <CardTitle>1. Upload a file</CardTitle>
            <CardDescription>
              Download the template, fill it in, then upload a .csv or .xlsx file.
              <b> name</b>, <b>category</b> and <b>brand</b> are required. Brand and
              category must match existing names (case-insensitive).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Download template
              </Button>

              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                onClick={() => fileRef.current?.click()}
                disabled={!catalogReady}
              >
                <Upload className="h-4 w-4 mr-2" />
                {catalogReady ? "Choose file…" : "Loading catalog…"}
              </Button>

              {fileName ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                  {fileName}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Step 2: preview */}
        {rows.length > 0 ? (
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle>2. Preview & validate</CardTitle>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
                    <Badge variant="secondary">{rows.length} parsed</Badge>
                    <Badge className="bg-green-600 text-white">
                      {validRows.length} valid
                    </Badge>
                    {rows.length - validRows.length > 0 ? (
                      <Badge variant="destructive">
                        {rows.length - validRows.length} with errors
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground">
                      {selectedValid.length} selected for import
                    </span>
                  </div>
                </div>

                <Button
                  onClick={onImport}
                  disabled={importing || selectedValid.length === 0}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {importing
                    ? "Importing…"
                    : `Import ${selectedValid.length} product(s)`}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[44px]">
                        <Checkbox
                          checked={
                            validRows.length > 0 &&
                            selectedValid.length === validRows.length
                          }
                          onCheckedChange={(v) => toggleAll(!!v)}
                          aria-label="Select all valid"
                        />
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="min-w-[200px]">Name</TableHead>
                      <TableHead>Slug</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Published</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, idx) => {
                      const ok = r.errors.length === 0;
                      return (
                        <TableRow key={idx} className={ok ? "" : "bg-destructive/5"}>
                          <TableCell>
                            <Checkbox
                              checked={r.selected}
                              disabled={!ok}
                              onCheckedChange={(v) => toggleRow(idx, !!v)}
                              aria-label="Select row"
                            />
                          </TableCell>
                          <TableCell>
                            {ok ? (
                              <Badge className="bg-green-600 text-white">Valid</Badge>
                            ) : (
                              <div className="flex items-start gap-1 text-destructive text-xs max-w-[260px]">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                <span>{r.errors.join("; ")}</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {String(r.raw.name ?? "") || (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.payload?.slug ?? slugify(String(r.raw.name ?? ""))}
                          </TableCell>
                          <TableCell>{String(r.raw.sku ?? "") || "—"}</TableCell>
                          <TableCell>{String(r.raw.brand ?? "") || "—"}</TableCell>
                          <TableCell>{String(r.raw.category ?? "") || "—"}</TableCell>
                          <TableCell>{String(r.raw.price ?? "") || "—"}</TableCell>
                          <TableCell>
                            {toBool(r.raw.is_published) ? "Yes" : "No"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
