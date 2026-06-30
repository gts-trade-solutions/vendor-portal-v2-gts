// Idempotent schema migration for the vendor portal (P1–P3 additions).
// Safe to re-run. Additive only — never touches madenkorea storefront data.
//
// Run from the vendor app root:
//   node --env-file=.env deploy/migrate.mjs
// (or ensure DATABASE_URL is exported in the environment, then `node deploy/migrate.mjs`)
//
// Applies, idempotently:
//   1. vendor_order_fulfillment  table   (P1 order dispatch)
//   2. vendor_activity_log       table   (P3 audit log)
//   3. invoice_companies.upi_vpa column  (P2 invoice payment QR)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    table,
    column,
  );
  return Number(rows[0].n) > 0;
}

async function main() {
  console.log("→ vendor_order_fulfillment");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS vendor_order_fulfillment (
      id CHAR(36) NOT NULL,
      order_id CHAR(36) NOT NULL,
      vendor_id CHAR(36) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      courier VARCHAR(255) NULL,
      tracking_number VARCHAR(255) NULL,
      tracking_url VARCHAR(1024) NULL,
      dispatched_at DATETIME(6) NULL,
      delivered_at DATETIME(6) NULL,
      notes MEDIUMTEXT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY uq_vof_order_vendor (order_id, vendor_id),
      KEY idx_vof_vendor (vendor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log("→ vendor_activity_log");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS vendor_activity_log (
      id CHAR(36) NOT NULL,
      vendor_id CHAR(36) NOT NULL,
      actor_user_id CHAR(36) NULL,
      actor_email VARCHAR(255) NULL,
      action VARCHAR(64) NOT NULL,
      entity_type VARCHAR(48) NULL,
      entity_id CHAR(36) NULL,
      summary VARCHAR(512) NULL,
      meta JSON NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      KEY idx_val_vendor_created (vendor_id, created_at),
      KEY idx_val_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log("→ invoice_companies.upi_vpa");
  if (await columnExists("invoice_companies", "upi_vpa")) {
    console.log("   already present, skipping");
  } else {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE invoice_companies ADD COLUMN upi_vpa VARCHAR(255) NULL AFTER swift_code",
    );
    console.log("   added");
  }

  console.log("\n✅ Schema migration complete.");
}

main()
  .catch((e) => {
    console.error("✗ Migration failed:", e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
