import "server-only";
import { prisma } from "@/lib/db/prisma";

export type VendorInfo = {
  id: string;
  display_name: string;
  slug: string | null;
  status: string;
  role: string | null;
  rejected_reason: string | null;
  expiry_alert_days: number;
};

// Prisma port of the Postgres get_my_vendor() RPC. The user's vendor = the one
// they own (vendors.owner_profile_id) OR are a member of (vendor_members.user_id).
// role = the member role, or "owner" when they own it. Oldest vendor wins.
export async function getMyVendor(userId: string): Promise<VendorInfo | null> {
  const v = await prisma.vendors.findFirst({
    where: {
      OR: [
        { owner_profile_id: userId },
        { vendor_members: { some: { user_id: userId } } },
      ],
    },
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      display_name: true,
      slug: true,
      status: true,
      owner_profile_id: true,
      rejected_reason: true,
      expiry_alert_days: true,
      vendor_members: { where: { user_id: userId }, select: { role: true }, take: 1 },
    },
  });
  if (!v) return null;
  return {
    id: v.id,
    display_name: v.display_name,
    slug: v.slug ?? null,
    status: v.status,
    role: v.vendor_members[0]?.role ?? (v.owner_profile_id === userId ? "owner" : null),
    rejected_reason: v.rejected_reason ?? null,
    expiry_alert_days: v.expiry_alert_days ?? 180,
  };
}
