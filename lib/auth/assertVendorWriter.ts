import "server-only";
import { NextResponse } from "next/server";
import { getRouteVendor } from "@/lib/auth/getRouteVendor";
import type { VendorInfo } from "@/lib/auth/getMyVendor";

// Port of the Postgres `assert_invoice_writer` / `is_vendor_admin` permission
// gate. A caller may MODIFY invoices/payments/inventory only when they are a
// vendor whose role is "owner" or "manager" (the vendor "admin" roles). Anyone
// else (logged-in vendor members with a lesser role, or non-vendors) is
// view-only.
//
// Usage in a write route:
//   const gate = await assertVendorWriter();
//   if (!gate.ok) return gate.response;        // 401 or 403 already shaped
//   const { userId, vendor } = gate;           // proceed with the write
const WRITER_ROLES = new Set(["owner", "manager"]);

type WriterOk = { ok: true; userId: string; vendor: VendorInfo };
type WriterFail = { ok: false; response: NextResponse };

export async function assertVendorWriter(): Promise<WriterOk | WriterFail> {
  const ctx = await getRouteVendor();
  if (!ctx) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }
  if (!ctx.vendor.role || !WRITER_ROLES.has(ctx.vendor.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error:
            "View-only access: you do not have permission to modify invoices.",
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, userId: ctx.userId, vendor: ctx.vendor };
}
