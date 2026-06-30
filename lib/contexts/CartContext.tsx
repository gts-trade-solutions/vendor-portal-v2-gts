"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/contexts/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import {
  ensureCartId,
  fetchCart,
  fetchCartItems,
  rpcAddToCart,
  rpcUpdateItem,
  rpcRemoveItem,
  rpcMergeGuestCart,
  CartTotals,
} from "@/lib/cartClient";

type CartItemRow = {
  id: string; // server id; for guests we reuse product_id as id
  product_id: string;
  quantity: number;
  unit_price?: number;
  line_total?: number;
  product?: any; // joined product row when authed
};

type CartContextType = {
  ready: boolean;
  loading: boolean;
  cartId: string | null;
  totals: CartTotals | null;
  items: CartItemRow[];
  totalItems: number;
  addItem: (productId: string, qty?: number) => Promise<void>;
  setQty: (itemId: string, qty: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
  clearGuest: () => void;
  clear: () => Promise<void>;                // <-- NEW (unified clear)
};

const CartContext = createContext<CartContextType>({} as any);
const GUEST_KEY = "guest_cart_v1";

function readGuest(): CartItemRow[] {
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeGuest(items: CartItemRow[]) {
  localStorage.setItem(GUEST_KEY, JSON.stringify(items));
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, ready: authReady } = useAuth();

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cartId, setCartId] = useState<string | null>(null);
  const [totals, setTotals] = useState<CartTotals | null>(null);
  const [items, setItems] = useState<CartItemRow[]>([]);

  const totalItems = useMemo(
    () => items.reduce((sum, item) => sum + (item.quantity || 0), 0),
    [items]
  );

  // Initial load + merge guest → server on login
  useEffect(() => {
    if (!authReady) return;

    (async () => {
      setLoading(true);

      if (!isAuthenticated) {
        setCartId(null);
        setTotals(null);
        setItems(readGuest());
        setReady(true);
        setLoading(false);
        return;
      }

      // merge guest cart if exists
      const guest = readGuest();
      if (guest.length) {
        await rpcMergeGuestCart(
          guest.map((g) => ({ product_id: g.product_id, quantity: g.quantity }))
        );
        writeGuest([]); // clear
      }

      // load server cart
      const id = await ensureCartId();
      setCartId(id);

      const c = await fetchCart();
      setTotals(c);
      const its = await fetchCartItems(id);
      setItems(
        its.map((i: any) => ({
          id: i.id,
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          line_total: i.line_total,
          product: i.product,
        }))
      );

      setReady(true);
      setLoading(false);
    })();
  }, [authReady, isAuthenticated]);

  const refresh = async () => {
    if (!isAuthenticated) {
      setItems(readGuest());
      setTotals(null);
      return;
    }
    const id = cartId ?? (await ensureCartId());
    setCartId(id);
    const c = await fetchCart();
    setTotals(c);
    const its = await fetchCartItems(id);
    setItems(
      its.map((i: any) => ({
        id: i.id,
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        line_total: i.line_total,
        product: i.product,
      }))
    );
  };

  const addItem = async (productId: string, qty = 1) => {
    if (!isAuthenticated) {
      // guest: upsert by product_id
      const list = readGuest();
      const idx = list.findIndex((i) => i.product_id === productId);
      if (idx >= 0) list[idx].quantity += qty;
      else list.push({ id: productId, product_id: productId, quantity: qty });
      writeGuest(list);
      setItems(list);
      return;
    }
    await rpcAddToCart(productId, qty);
    await refresh();
  };

  const setQty = async (itemId: string, qty: number) => {
    if (!isAuthenticated) {
      const list = readGuest();
      const idx = list.findIndex((i) => i.id === itemId);
      if (idx >= 0) {
        if (qty <= 0) list.splice(idx, 1);
        else list[idx].quantity = qty;
        writeGuest(list);
        setItems(list);
      }
      return;
    }
    await rpcUpdateItem(itemId, qty);
    await refresh();
  };

  const removeItem = async (itemId: string) => {
    if (!isAuthenticated) {
      const list = readGuest().filter((i) => i.id !== itemId);
      writeGuest(list);
      setItems(list);
      return;
    }
    await rpcRemoveItem(itemId);
    await refresh();
  };

  const clearGuest = () => {
    writeGuest([]);
    setItems([]);
  };

  // NEW: unified clear for guests + authed users
  const clear = async () => {
    try {
      if (!isAuthenticated) {
        clearGuest();
        setTotals(null);
        return;
      }
      // tolerate absence if your order RPC already empties server cart
      await supabase.rpc("cart_clear");
      setItems([]);
      setTotals(null);
    } catch (e) {
      console.error("cart.clear error", e);
    }
  };

  const value = useMemo(
    () => ({
      ready,
      loading,
      cartId,
      totals,
      items,
      totalItems,
      addItem,
      setQty,
      removeItem,
      refresh,
      clearGuest,
      clear,                 // expose
    }),
    [ready, loading, cartId, totals, items]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
