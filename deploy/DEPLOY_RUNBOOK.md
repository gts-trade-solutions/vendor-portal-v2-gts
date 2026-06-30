# Vendor Portal — Deployment Runbook

Prepared flow for deploying the vendor portal (MySQL + NextAuth + S3; **no Supabase
runtime dependency**). This is a **plan only** — nothing here has been run against
production. Execute on the server when ready.

> The vendor app **shares** madenkorea's MySQL database (`madenkorea`) and the
> `madenkorea-media` S3 bucket. It is a **separate Next.js app/process** from the
> madenkorea storefront and runs on its own port.

---

## 0. Prerequisites
- **Node ≥ 22** on the server (the AWS SDK v3 warns on older; 21 works today but upgrade).
- Access to the production MySQL `madenkorea` DB (a user with DDL + DML rights).
- The same **AWS creds** madenkorea uses for SES + the `madenkorea-media` S3 bucket.
- A process manager (pm2 / systemd) and a reverse proxy (nginx) — mirror how the
  madenkorea app is served on the VPS, on a **different port** (e.g. 3001).

---

## 1. Environment variables (`.env` in the app root)
Set these on the server (values NOT in this repo). Names only:

**Database / Auth**
- `DATABASE_URL` = `mysql://<user>:<pass>@<host>:3306/madenkorea`
- `NEXTAUTH_URL` = the vendor portal's public URL (e.g. `https://vendor.madenkorea.com`)
- `NEXTAUTH_SECRET` = a strong secret (`openssl rand -base64 32`)
- `AUTH_BACKEND=nextauth`, `NEXT_PUBLIC_AUTH_BACKEND=nextauth`
- (Optional OAuth) `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`

**Email (SES)** — same creds as madenkorea
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (= `ap-south-1`)
- `AWS_SES_REGION`, `AWS_FROM_EMAIL`
- (also keep `SES_ACCESS_KEY_ID/SES_SECRET_ACCESS_KEY/SES_REGION` if any shared lib reads them)

**Storage (S3)** — bucket already holds the mirrored media
- `NEXT_PUBLIC_STORAGE_BACKEND=s3`
- `STORAGE_BACKEND=s3`
- `S3_MEDIA_BUCKET=madenkorea-media`
- `NEXT_PUBLIC_MEDIA_CDN_URL=https://madenkorea-media.s3.ap-south-1.amazonaws.com`

**Supabase keys** — only still needed if you choose NOT to flip storage to S3
(`NEXT_PUBLIC_STORAGE_BACKEND≠s3`); with S3 on, the app makes zero Supabase calls.

---

## 2. Code + dependencies
```bash
# pull the vendor app code to the server (your normal mechanism)
npm ci            # or: npm install
```

## 3. Schema migration (idempotent, additive)
Apply the schema changes. **Use the SQL file via `mysql` — not only `migrate.mjs`:**
```bash
mysql -u <user> -p madenkorea < deploy/schema_changes.sql   # REQUIRED for the stock triggers
# migrate.mjs covers the tables/columns but CANNOT create the triggers
# (Prisma's prepared-statement protocol rejects CREATE TRIGGER — MySQL error 1295).
node --env-file=.env deploy/migrate.mjs                      # optional: tables/columns only
```
Creates/adds:
- `vendor_order_fulfillment`, `vendor_activity_log`, `invoice_companies.upi_vpa` (earlier work)
- **`products.vendor_price`** (online + offline dual pricing) — *product unification*
- **Stock-sync triggers** `trg_iu_stock_ai/au/ad` + a one-time `stock_qty` backfill —
  makes `products.stock_qty` DB-derived from `inventory_units` so the **storefront** shows
  accurate availability (0 stock ⇒ out of stock). The storefront needs **no** code change.

> ⚠️ **Order vs. the data resync (§5):** if you run the full-resync AFTER this, the
> triggers fire on unit re-insert and `stock_qty` self-corrects — but to be safe, re-run
> just the backfill `UPDATE products … stock_qty = (SELECT COUNT(*) …)` (bottom of
> `schema_changes.sql`) once the resync finishes.

## 3b. Re-apply the product merges (one-time, product unification)
On the local DB, 5 duplicate published↔hidden products were merged into single products
(stock moved onto the storefront row, duplicate soft-archived, `vendor_price` set). To
reproduce on prod, the simplest path: **log in as the catalog vendor and use the new
`/vendor/products/merge` page** — it auto-detects the same duplicate pairs and merges each
(set the Vendor price = the online price). The merge is transactional + reversible
(`deleted_at`). Alternatively run the merge script used locally.

## 4. Prisma client
```bash
npx prisma generate
```

## 5. Data sync (first cutover only)
The vendor tables on prod MySQL may lag live Supabase if the vendor app was still
writing to Supabase. If this is the **first** cutover, run a one-time Supabase→MySQL
resync (the madenkorea ETL tool, run from the **madenkorea** app dir which has the
Supabase service key + the same DB):
```bash
# in the madenkorea app dir:
node migration/etl/full-resync.mjs            # all tables, idempotent, FK-safe
# or a subset, e.g.:  node migration/etl/full-resync.mjs invoices invoice_items inventory_units products
```
After cutover the vendor app is MySQL-authoritative; do NOT keep resyncing (it would
overwrite MySQL with stale Supabase data).

## 6. Build + start
```bash
npm run build         # must exit 0 (verified locally: clean, 31 pages)
npm run start         # behind pm2/systemd on the chosen port
```

---

## 7. Post-deploy verification (smoke)
- Log in at `/vendor/login` (existing bcrypt creds work — passwords were migrated, no reset).
- Dashboard `/vendor` loads with live numbers; notification bell shows counts.
- Create + view an invoice; record a payment; **Duplicate**; download the list export.
- `/vendor/products` loads; add a product; upload an image → confirm the URL is
  `…madenkorea-media.s3…` (S3, not Supabase).
- `/vendor/orders/<id>` → mark dispatched (carrier+tracking persists).
- `/vendor/invoice-companies` → set a company `upi_vpa` → invoice view shows the UPI QR.
- `/vendor/payouts`, `/vendor/reports` (download an XLSX), `/vendor/activity` (shows the
  actions you just performed), `/vendor/settings` (edit profile; change password).
- Trigger a password reset → confirm the SES email arrives.

## 8. madenkorea storefront — S3 flip (do together)
The media is already mirrored to S3, but the **storefront** still resolves images via
Supabase unless flipped. Images NEWLY uploaded by vendors go to S3 only, so to show
them on the storefront set in the **madenkorea** app `.env`:
```
NEXT_PUBLIC_STORAGE_BACKEND=s3
STORAGE_BACKEND=s3
S3_MEDIA_BUCKET=madenkorea-media
NEXT_PUBLIC_MEDIA_CDN_URL=https://madenkorea-media.s3.ap-south-1.amazonaws.com
```
then rebuild/restart madenkorea. (Existing images work either way — they're in both.)

## 9. OAuth / external consoles (if using social login)
- Add the vendor portal callback URL to Google/Facebook consoles:
  `https://<vendor-domain>/api/auth/callback/{google|facebook}`.

---

## Rollback
- Schema changes are additive — leaving the new tables/column in place is harmless if
  you roll the app back. No destructive DDL is performed.
- App rollback = redeploy the previous build/commit.

## Notes / gotchas
- After deploying many new route files, if you see Next "missing required error
  components" / cold 404s, `rm -rf .next && npm run build` (or restart) clears it.
- `vendor_order_fulfillment` + `vendor_activity_log` + `invoice_companies.upi_vpa`
  exist in the vendor app's `prisma/schema.prisma` only — add them to madenkorea's
  schema only if that app ever needs to read them.
- Invoices/invoice_companies are org-shared (no `vendor_id`); dashboard reports +
  customer drill-downs are intentionally org-wide.
