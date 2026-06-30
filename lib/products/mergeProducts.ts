import "server-only";
import { Prisma } from "@prisma/client";

// Merge a duplicate product into a survivor (the unified single-product model).
// Used when the same real item exists twice — a PUBLISHED storefront row and a
// HIDDEN inventory row (the legacy two-product pattern). The survivor keeps its
// storefront identity (slug/SEO/reviews/country-prices/images); the duplicate's
// STOCK (inventory_units) moves onto the survivor so the site product owns its
// stock, the survivor gains a vendor_price (offline sale price), and the
// duplicate is SOFT-archived (deleted_at) — fully reversible.
//
// Both products must belong to `vendorId` (vendor-scoping / IDOR guard). Run
// inside a prisma.$transaction so the whole operation is atomic.
//
// NOTE: invoice history (invoice_items / invoice_units) on the duplicate is left
// in place — the duplicate row stays (soft-deleted) so those references remain
// valid and historically accurate. Only live stock moves.

export class MergeError extends Error {}

type MergeArgs = {
  survivorId: string;
  duplicateId: string;
  vendorId: string;
  // Optional explicit vendor (offline) price for the survivor. When omitted,
  // it's seeded from the survivor's existing value, else the duplicate's price.
  vendorPrice?: number | null;
};

export async function mergeProducts(
  tx: Prisma.TransactionClient,
  { survivorId, duplicateId, vendorId, vendorPrice: vendorPriceOverride }: MergeArgs,
): Promise<{ unitsMoved: number; vendorPrice: number | null }> {
  if (!survivorId || !duplicateId) throw new MergeError("survivor_id and duplicate_id are required");
  if (survivorId === duplicateId) throw new MergeError("Cannot merge a product into itself");

  const sel = {
    id: true,
    vendor_id: true,
    name: true,
    price: true,
    purchase_price: true,
    vendor_price: true,
    deleted_at: true,
  } as const;

  const survivor = await tx.products.findUnique({ where: { id: survivorId }, select: sel });
  const duplicate = await tx.products.findUnique({ where: { id: duplicateId }, select: sel });
  if (!survivor) throw new MergeError("Survivor product not found");
  if (!duplicate) throw new MergeError("Duplicate product not found");

  // Vendor scope: both rows must be owned by the acting vendor.
  if (survivor.vendor_id !== vendorId || duplicate.vendor_id !== vendorId) {
    throw new MergeError("Both products must belong to your vendor account");
  }
  if (duplicate.deleted_at) throw new MergeError("Duplicate product is already archived");

  // 1) Move the duplicate's live stock onto the survivor (site product now owns it).
  const moved = await tx.inventory_units.updateMany({
    where: { product_id: duplicateId },
    data: { product_id: survivorId, updated_at: new Date() },
  });

  // 2) Set the survivor's vendor (offline) price + cost from the duplicate when
  //    the survivor doesn't already have them. The hidden row's `price` is the
  //    vendor sale price in this dataset.
  const vendorPrice =
    vendorPriceOverride !== undefined && vendorPriceOverride !== null
      ? Number(vendorPriceOverride)
      : survivor.vendor_price != null
        ? Number(survivor.vendor_price)
        : duplicate.vendor_price != null
          ? Number(duplicate.vendor_price)
          : duplicate.price != null
            ? Number(duplicate.price)
            : null;

  const survivorCost = Number(survivor.purchase_price ?? 0);
  const dupCost = Number(duplicate.purchase_price ?? 0);
  const purchasePrice = survivorCost > 0 ? survivorCost : dupCost;

  await tx.products.update({
    where: { id: survivorId },
    data: {
      vendor_price: vendorPrice,
      purchase_price: purchasePrice,
      track_inventory: true,
      updated_at: new Date(),
    },
  });

  // 3) Soft-archive the duplicate (reversible). Keep it hidden + flagged deleted.
  await tx.products.update({
    where: { id: duplicateId },
    data: { deleted_at: new Date(), is_published: false, updated_at: new Date() },
  });

  return { unitsMoved: moved.count, vendorPrice };
}
