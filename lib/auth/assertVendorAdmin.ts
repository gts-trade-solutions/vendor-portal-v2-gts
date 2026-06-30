import "server-only";
import { NextResponse } from "next/server";
import { getRouteVendor } from "./getRouteVendor";
import type { VendorInfo } from "./getMyVendor";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Port of the Postgres `is_vendor_admin` gate. Resolves the caller's vendor and
// only lets owners/managers through. Used by the team-management endpoints.
//   - not logged in / not a vendor -> 401 Unauthorized
//   - logged-in member but role not owner|manager -> 403 Not allowed
export type AssertVendorAdminResult =
  | { ok: true; userId: string; vendor: VendorInfo }
  | { ok: false; response: NextResponse };

export async function assertVendorAdmin(): Promise<AssertVendorAdminResult> {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return { ok: false, response: json({ ok: false, error: "Unauthorized" }, 401) };
  }
  if (ctx.vendor.role !== "owner" && ctx.vendor.role !== "manager") {
    return { ok: false, response: json({ ok: false, error: "Not allowed" }, 403) };
  }
  return { ok: true, userId: ctx.userId, vendor: ctx.vendor };
}
