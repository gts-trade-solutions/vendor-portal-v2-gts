import { supabase } from '@/lib/supabaseClient';

export type CartTotals = {
  id: string;
  currency: string;
  subtotal: number;
  shipping_fee_estimate: number;
  discount_total: number;
  total_estimate: number;
};

export async function ensureCartId(): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_cart');
  if (error) throw error;
  return data as string;
}

export async function fetchCart(): Promise<CartTotals | null> {
  const { data, error } = await supabase.from('carts').select('*').maybeSingle();
  if (error) throw error;
  return data as any;
}

export async function fetchCartItems(cartId: string) {
  const { data, error } = await supabase
    .from('cart_items')
    .select(`
      id, quantity, unit_price, line_total, product_id,
      product:products (
        id, slug, name, price, currency,
        compare_at_price, sale_price, sale_starts_at, sale_ends_at,
        hero_image_path, brands ( name )
      )
    `)
    .eq('cart_id', cartId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as any[];
}

export async function rpcAddToCart(productId: string, qty = 1) {
  const { data, error } = await supabase.rpc('add_to_cart', {
    p_product_id: productId,
    p_qty: qty,
  });
  if (error) throw error;
  return data;
}

export async function rpcUpdateItem(itemId: string, qty: number) {
  const { error } = await supabase.rpc('update_cart_item', {
    p_item_id: itemId,
    p_qty: qty,
  });
  if (error) throw error;
}

export async function rpcRemoveItem(itemId: string) {
  const { error } = await supabase.rpc('remove_cart_item', { p_item_id: itemId });
  if (error) throw error;
}

export async function rpcMergeGuestCart(items: { product_id: string; quantity: number }[]) {
  const { error } = await supabase.rpc('merge_cart', { p_items: items as any });
  if (error) throw error;
}
