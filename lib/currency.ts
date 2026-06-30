// lib/currency.ts
export function roundMoney(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
