import "server-only";
import { getRouteUser } from "./routeUser";
import { getMyVendor, type VendorInfo } from "./getMyVendor";

// The current vendor for server routes: NextAuth user -> their vendor (the gate).
// Every vendor-scoped read/write endpoint uses this so it only ever touches the
// caller's own vendor data. Returns null when not logged in, not a vendor, or
// the vendor is not APPROVED.
//
// The approval check is enforced HERE (server-side) — not only in the client
// <VendorGate> — so a pending/rejected/disabled vendor cannot reach the data or
// write APIs by calling them directly. /api/vendor/me uses getMyVendor directly
// (not this gate), so the pending/rejected status screens still render.
export async function getRouteVendor(): Promise<
  { userId: string; vendor: VendorInfo } | null
> {
  const user = await getRouteUser();
  if (!user) return null;
  const vendor = await getMyVendor(user.id);
  if (!vendor) return null;
  if (vendor.status !== "approved") return null;
  return { userId: user.id, vendor };
}
