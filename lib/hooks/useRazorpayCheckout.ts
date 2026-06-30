"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useCart } from "@/lib/contexts/CartContext";

/** What we pass from checkout -> hook -> /api/razorpay/create */
export type AttributionSnapshot = null | {
  type: "promo" | "link";
  code?: string;
  product_id?: string | null;
};

export type AddressSnapshot = null | {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
};

// d.ts safety for Razorpay
declare global {
  interface Window {
    Razorpay?: any;
  }
}

export function useRazorpayCheckout() {
  const router = useRouter();
  const busyRef = useRef(false);
  const { clear } = useCart(); // unified cart clear

  /**
   * Kick off the Razorpay flow.
   * @param address  shipping/contact snapshot
   * @param attribution  promo/link snapshot
   * @param uiTotal  optional UI-side total
   */
  const start = async (
    address: AddressSnapshot = null,
    attribution: AttributionSnapshot = null,
    uiTotal?: number | null
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      // 1) Create app order from cart via RPC
      const { data: created, error: cErr } = await supabase.rpc(
        "create_order_from_cart",
        { p_address: address ?? null, p_notes: null }
      );
      if (cErr || !created || !created[0]) {
        toast.error(cErr?.message || "Could not create order");
        busyRef.current = false;
        return;
      }

      const info = created[0] as {
        order_id: string;
        total: number;
        order_number?: string;
      };

      // 2) Ask server to create a Razorpay order
      const res = await fetch("/api/razorpay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: info.order_id,
          ui_total: typeof uiTotal === "number" ? uiTotal : info.total,
          attribution,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.razorpay_order?.id) {
        toast.error(j?.error ? String(j.error) : "Payment init failed");
        busyRef.current = false;
        return;
      }

      const { key, razorpay_order } = j;

      // ✅ Old flow — trust server total, just log info
      if (typeof uiTotal === "number") {
        console.log(
          "[RZP] Proceeding with server total:",
          razorpay_order.amount / 100,
          "UI:",
          uiTotal
        );
      }

      // 3) Ensure SDK present
      if (!window.Razorpay) {
        toast.error("Razorpay SDK not loaded");
        busyRef.current = false;
        return;
      }

      // 4) Open Razorpay widget
      const rzp = new window.Razorpay({
        key,
        amount: razorpay_order.amount,
        currency: razorpay_order.currency,
        name: "Checkout",
        description: "Order payment",
        order_id: razorpay_order.id,
        prefill: {
          name: address?.name || "",
          email: address?.email || "",
          contact: address?.phone || "",
        },
        notes: { app_order_id: info.order_id },
        handler: async (resp: any) => {
          try {
            // 5) Verify payment on server
            const verify = await fetch("/api/razorpay/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
                app_order_id: info.order_id,
                raw: resp,
              }),
            });

            const vj = await verify.json().catch(() => ({}));

            if (!verify.ok || !vj?.ok) {
              toast.error(vj?.error || "Payment verification failed");
              router.replace(
                `/order/failure?reason=verification&order_id=${encodeURIComponent(
                  info.order_id
                )}`
              );
              return;
            }

            // ✅ Clear cart (guest + server)
            try {
              if (typeof window !== "undefined") {
                localStorage.setItem("guest_cart_v1", "[]");
                sessionStorage.removeItem("guest_cart_v1");
              }
              await clear?.();
            } catch (e) {
              console.warn("[CART] clear warning", e);
            }

            // ✅ Route to success page
            router.replace(
              `/order/success?order_id=${encodeURIComponent(
                vj.order_id || info.order_id
              )}&order_no=${encodeURIComponent(
                vj.order_number || info.order_number
              )}`
            );
          } catch (e: any) {
            console.error("[PAY] verify handler error", e);
            toast.error(e?.message || "Payment error");
          } finally {
            busyRef.current = false;
          }
        },
        modal: {
          ondismiss() {
            toast.info("Payment cancelled");
            busyRef.current = false;
          },
        },
        theme: { color: "#3399cc" },
      });

      rzp.on("payment.failed", () => {
        toast.error("Payment failed");
        busyRef.current = false;
      });

      rzp.open();
    } catch (e: any) {
      console.error("[PAY] start() error", e);
      toast.error(e?.message || "Something went wrong");
      busyRef.current = false;
    }
  };

  return { start };
}
