import { supabase } from '@/lib/supabaseClient';

export type Address = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;       // "India"
  is_default: boolean;
};

export async function fetchAddresses(): Promise<Address[]> {
  const { data, error } = await supabase.rpc('get_my_addresses');
  if (error) throw error;
  return data ?? [];
}

export async function saveAddress(a: Partial<Address> & { id?: string; set_default?: boolean }) {
  const { data, error } = await supabase.rpc('upsert_address', {
    p_id: a.id ?? null,
    p_name: a.name ?? null,
    p_phone: a.phone ?? null,
    p_email: a.email ?? null,
    p_line1: a.line1,
    p_line2: a.line2 ?? null,
    p_landmark: a.landmark ?? null,
    p_city: a.city,
    p_state: a.state,
    p_pincode: a.pincode,
    p_country: a.country ?? 'India',
    p_set_default: !!a.set_default,
  });
  if (error) throw error;
  return data as Address;
}

export async function setDefaultAddress(addressId: string) {
  const { error } = await supabase.rpc('set_default_address', { p_address_id: addressId });
  if (error) throw error;
}

export async function deleteAddress(addressId: string) {
  const { error } = await supabase.rpc('delete_address', { p_address_id: addressId });
  if (error) throw error;
}
