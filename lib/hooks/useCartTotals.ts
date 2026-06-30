// /lib/hooks/useCartTotals.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalcLine, CalcResponse } from "@/types/cart";

function debounce<F extends (...args: any[]) => void>(fn: F, wait = 250) {
  let t: any;
  return (...args: Parameters<F>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function useCartTotals(lines: CalcLine[], shippingFee: number) {
  const [data, setData] = useState<CalcResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const payload = useMemo(() => ({ lines, shippingFee }), [lines, shippingFee]);
  const fetcherRef = useRef(
    debounce(async (body: any) => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/api/checkout/calc-totals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        const json = (await res.json()) as CalcResponse & { error?: string };
        if (!json.ok) throw new Error(json.error || "CALC_FAILED");
        setData(json);
      } catch (e: any) {
        setErr(e?.message || "CALC_FAILED");
        setData(null);
      } finally {
        setLoading(false);
      }
    }, 300)
  );

  useEffect(() => {
    fetcherRef.current(payload);
  }, [payload]);

  const refetch = useCallback(() => fetcherRef.current(payload), [payload]);

  return { data, loading, error: err, refetch };
}
