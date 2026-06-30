import "server-only";

// Prisma returns Decimal (Decimal.js), BigInt, and Date instances that
// NextResponse.json() cannot serialize (BigInt throws; Decimal/Date leak
// internal shapes). jsonSafe deep-converts a Prisma result into plain JSON:
//   Decimal -> number, BigInt -> number, Date -> ISO string.
// Keeps the wire shape identical to what the old Supabase/PostgREST client
// returned so client pages stay unchanged.
export function jsonSafe<T>(value: T): T {
  return convert(value) as T;
}

function convert(v: any): any {
  if (v == null) return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  // Prisma Decimal (decimal.js) exposes toNumber()/toString() + a brand.
  if (typeof v === "object" && typeof v.toNumber === "function" && "d" in v && "s" in v) {
    return v.toNumber();
  }
  if (Array.isArray(v)) return v.map(convert);
  if (typeof v === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) out[k] = convert(v[k]);
    return out;
  }
  return v;
}
