-- ===========================================================================
-- Vendor Portal — schema changes introduced during the MySQL migration + P1–P3
-- feature work. Apply these to the PRODUCTION MySQL (`madenkorea`) database
-- before/at the vendor-portal deploy. All statements are idempotent and additive
-- (safe to re-run; they never touch madenkorea storefront data).
--
-- These tables/columns live in the vendor app's prisma/schema.prisma but are NOT
-- in the madenkorea app's schema — they are vendor-portal-only.
--
-- Apply with:  mysql -u <user> -p madenkorea < deploy/schema_changes.sql
-- (or run deploy/migrate.mjs which does the same thing idempotently via Prisma.)
-- ===========================================================================

-- 1) Per-vendor fulfillment of (shared, storefront) orders  [P1 — order dispatch]
CREATE TABLE IF NOT EXISTS vendor_order_fulfillment (
  id              CHAR(36)      NOT NULL,
  order_id        CHAR(36)      NOT NULL,
  vendor_id       CHAR(36)      NOT NULL,
  status          VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
  courier         VARCHAR(255)  NULL,
  tracking_number VARCHAR(255)  NULL,
  tracking_url    VARCHAR(1024) NULL,
  dispatched_at   DATETIME(6)   NULL,
  delivered_at    DATETIME(6)   NULL,
  notes           MEDIUMTEXT    NULL,
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_vof_order_vendor (order_id, vendor_id),
  KEY idx_vof_vendor (vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Per-vendor activity / audit trail  [P3 — audit log]
CREATE TABLE IF NOT EXISTS vendor_activity_log (
  id            CHAR(36)     NOT NULL,
  vendor_id     CHAR(36)     NOT NULL,
  actor_user_id CHAR(36)     NULL,
  actor_email   VARCHAR(255) NULL,
  action        VARCHAR(64)  NOT NULL,
  entity_type   VARCHAR(48)  NULL,
  entity_id     CHAR(36)     NULL,
  summary       VARCHAR(512) NULL,
  meta          JSON         NULL,
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_val_vendor_created (vendor_id, created_at),
  KEY idx_val_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) UPI VPA on seller companies (for the invoice payment QR)  [P2 — invoice companies]
-- MySQL 8.0.29+ supports IF NOT EXISTS on ADD COLUMN. If your server is older,
-- run deploy/migrate.mjs instead (it checks information_schema first).
ALTER TABLE invoice_companies
  ADD COLUMN IF NOT EXISTS upi_vpa VARCHAR(255) NULL AFTER swift_code;

-- 4) Vendor (offline / invoice) sale price on products  [product unification]
-- The unified single-product model carries BOTH an online price (`price`) and an
-- offline/vendor sale price (`vendor_price`). Storefront still reads `price`.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS vendor_price DECIMAL(12,2) NULL AFTER sale_price;

-- 5) Stock sync: keep products.stock_qty = COUNT(IN_STOCK inventory_units)
--    [stock unification — standard "0 inventory = out of stock" flow]
-- The madenkorea STOREFRONT reads products.stock_qty for availability + the
-- checkout `stock_qty <= 0` block. Previously stock_qty was a manually-typed
-- field that drifted from the real inventory_units. These triggers make it
-- DB-derived: any unit insert/status-change/transfer/delete/merge/online-order
-- allocation auto-recomputes the affected product(s) stock_qty. No app code path
-- needs to maintain it. (CREATE TRIGGER has no IF NOT EXISTS, so DROP-then-CREATE
-- keeps this idempotent.)
DROP TRIGGER IF EXISTS trg_iu_stock_ai;
DROP TRIGGER IF EXISTS trg_iu_stock_au;
DROP TRIGGER IF EXISTS trg_iu_stock_ad;

CREATE TRIGGER trg_iu_stock_ai AFTER INSERT ON inventory_units FOR EACH ROW
  UPDATE products SET stock_qty = (
    SELECT COUNT(*) FROM inventory_units WHERE product_id = NEW.product_id AND status = 'IN_STOCK'
  ) WHERE id = NEW.product_id;

CREATE TRIGGER trg_iu_stock_ad AFTER DELETE ON inventory_units FOR EACH ROW
  UPDATE products SET stock_qty = (
    SELECT COUNT(*) FROM inventory_units WHERE product_id = OLD.product_id AND status = 'IN_STOCK'
  ) WHERE id = OLD.product_id;

CREATE TRIGGER trg_iu_stock_au AFTER UPDATE ON inventory_units FOR EACH ROW
  BEGIN
    UPDATE products SET stock_qty = (
      SELECT COUNT(*) FROM inventory_units WHERE product_id = NEW.product_id AND status = 'IN_STOCK'
    ) WHERE id = NEW.product_id;
    IF OLD.product_id <> NEW.product_id THEN
      UPDATE products SET stock_qty = (
        SELECT COUNT(*) FROM inventory_units WHERE product_id = OLD.product_id AND status = 'IN_STOCK'
      ) WHERE id = OLD.product_id;
    END IF;
  END;

-- One-time backfill so existing rows match reality immediately after the triggers
-- are installed (the triggers only fire on FUTURE unit changes).
UPDATE products p SET stock_qty = (
  SELECT COUNT(*) FROM inventory_units u WHERE u.product_id = p.id AND u.status = 'IN_STOCK'
);

-- 6) Keep BUNDLES sellable after the backfill  [ENABLED per deploy decision]
-- The backfill above makes any product with 0 IN-STOCK units show OUT OF STOCK on
-- the storefront. Bundles/kits (is_bundle = 1) do NOT hold their own units, so this
-- marks them "always available" (track_inventory = 0 ⇒ storefront ignores stock_qty)
-- to keep them buyable. Does NOT affect non-bundle products — those follow the strict
-- "0 inventory = out of stock" flow.
UPDATE products SET track_inventory = 0 WHERE is_bundle = 1;
