// lib/promo-cookie.ts
import { cookies } from "next/headers";

const COOKIE_NAME = "promo_code";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function getPromoCodeFromCookie() {
  try { return cookies().get(COOKIE_NAME)?.value?.toUpperCase() ?? null; } catch { return null; }
}
export function setPromoCookie(code: string) {
  cookies().set({ name: COOKIE_NAME, value: code.toUpperCase(), httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: MAX_AGE });
}
export function clearPromoCookie() {
  cookies().set({ name: COOKIE_NAME, value: "", path: "/", maxAge: 0 });
}
