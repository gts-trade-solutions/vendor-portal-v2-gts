// utils/getVendor.ts

export type VendorInfo = {
  id: string;
  display_name: string;
  slug: string | null;
  status: 'pending'|'approved'|'rejected'|'disabled';
  role: 'owner'|'manager'|'staff'|null;
  rejected_reason?: string | null;
};

export async function fetchMyVendor(): Promise<VendorInfo | null> {
  const res = await fetch('/api/vendor/me', { cache: 'no-store' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Failed to load vendor');
  const body = await res.json().catch(() => ({}));
  return (body?.vendor as VendorInfo) ?? null;
}
