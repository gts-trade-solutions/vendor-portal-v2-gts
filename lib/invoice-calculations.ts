export type InvoiceTaxType = "CGST_SGST" | "IGST" | "NONE";

const sanitizeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sanitizePercent = (value: unknown) => {
  const percent = sanitizeNumber(value);
  if (percent < 0) return 0;
  if (percent > 100) return 100;
  return percent;
};

export const round2 = (value: unknown) => Number(sanitizeNumber(value).toFixed(2));

export const getDiscountPercentFromStored = (
  storedLineDiscount: unknown,
  quantity: unknown,
  unitPrice: unknown,
) => {
  const qty = sanitizeNumber(quantity);
  const price = sanitizeNumber(unitPrice);
  if (qty <= 0 || price <= 0) return 0;

  const perUnitDiscountAmount = sanitizeNumber(storedLineDiscount) / qty;
  return round2((perUnitDiscountAmount / price) * 100);
};

export const calculateLineAmounts = ({
  quantity,
  unitPrice,
  discountPercent,
}: {
  quantity: unknown;
  unitPrice: unknown;
  discountPercent: unknown;
}) => {
  const qty = sanitizeNumber(quantity);
  const price = sanitizeNumber(unitPrice);
  const percent = sanitizePercent(discountPercent);

  const lineSubtotal = qty * price;
  const discountPerUnitAmount = price * (percent / 100);
  const totalDiscount = qty * discountPerUnitAmount;
  const lineTotal = lineSubtotal - totalDiscount;

  return {
    quantity: qty,
    unitPrice: price,
    discountPercent: percent,
    discountPerUnitAmount: round2(discountPerUnitAmount),
    lineSubtotal: round2(lineSubtotal),
    totalDiscount: round2(totalDiscount),
    lineTotal: round2(lineTotal),
  };
};

export const calculateInvoiceLineTotals = (
  lines: Array<{
    quantity: unknown;
    unitPrice: unknown;
    discountPercent: unknown;
  }>,
) => {
  const totals = lines.reduce(
    (acc, line) => {
      const computed = calculateLineAmounts(line);
      acc.subtotal += computed.lineSubtotal;
      acc.discountTotal += computed.totalDiscount;
      acc.invoiceAmount += computed.lineTotal;
      return acc;
    },
    { subtotal: 0, discountTotal: 0, invoiceAmount: 0 },
  );

  return {
    subtotal: round2(totals.subtotal),
    discountTotal: round2(totals.discountTotal),
    invoiceAmount: round2(totals.invoiceAmount),
  };
};

export const calculateInclusiveTaxBreakdown = ({
  invoiceAmount,
  taxType,
  cgstPercent,
  sgstPercent,
  igstPercent,
}: {
  invoiceAmount: unknown;
  taxType: InvoiceTaxType;
  cgstPercent: unknown;
  sgstPercent: unknown;
  igstPercent: unknown;
}) => {
  const gross = round2(invoiceAmount);
  const cgstRate = taxType === "CGST_SGST" ? sanitizeNumber(cgstPercent) : 0;
  const sgstRate = taxType === "CGST_SGST" ? sanitizeNumber(sgstPercent) : 0;
  const igstRate = taxType === "IGST" ? sanitizeNumber(igstPercent) : 0;
  const totalTaxRate = cgstRate + sgstRate + igstRate;

  if (gross <= 0 || totalTaxRate <= 0) {
    return {
      taxableAmount: gross,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      taxTotal: 0,
      grandTotal: gross,
    };
  }

  const rawTaxableAmount = gross / (1 + totalTaxRate / 100);
  const cgstAmount = round2((rawTaxableAmount * cgstRate) / 100);
  const sgstAmount = round2((rawTaxableAmount * sgstRate) / 100);
  const igstAmount = round2((rawTaxableAmount * igstRate) / 100);
  const taxTotal = round2(cgstAmount + sgstAmount + igstAmount);
  const taxableAmount = round2(gross - taxTotal);

  return {
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    taxTotal,
    grandTotal: gross,
  };
};

// Tax EXCLUSIVE: the line amount is the pre-tax base; tax is ADDED on top, so the
// grand total = base + tax. (calculateInclusiveTaxBreakdown treats the line amount
// as already tax-inclusive and extracts the tax from within it instead.)
export const calculateExclusiveTaxBreakdown = ({
  invoiceAmount,
  taxType,
  cgstPercent,
  sgstPercent,
  igstPercent,
}: {
  invoiceAmount: unknown;
  taxType: InvoiceTaxType;
  cgstPercent: unknown;
  sgstPercent: unknown;
  igstPercent: unknown;
}) => {
  const base = round2(invoiceAmount);
  const cgstRate = taxType === "CGST_SGST" ? sanitizeNumber(cgstPercent) : 0;
  const sgstRate = taxType === "CGST_SGST" ? sanitizeNumber(sgstPercent) : 0;
  const igstRate = taxType === "IGST" ? sanitizeNumber(igstPercent) : 0;

  const cgstAmount = round2((base * cgstRate) / 100);
  const sgstAmount = round2((base * sgstRate) / 100);
  const igstAmount = round2((base * igstRate) / 100);
  const taxTotal = round2(cgstAmount + sgstAmount + igstAmount);

  return {
    taxableAmount: base,
    cgstAmount,
    sgstAmount,
    igstAmount,
    taxTotal,
    grandTotal: round2(base + taxTotal),
  };
};


export function getDiscountAmountPerUnit(mrp: number, discountPct: number) {
  const safeMrp = Number(mrp || 0);
  const safePct = Number(discountPct || 0);
  return (safeMrp * safePct) / 100;
}

export function getPerUnitPriceAfterDiscount(mrp: number, discountPct: number) {
  const safeMrp = Number(mrp || 0);
  const discountPerUnit = getDiscountAmountPerUnit(safeMrp, discountPct);
  return safeMrp - discountPerUnit;
}

export function getLineTotalDiscount(mrp: number, qty: number, discountPct: number) {
  const safeQty = Number(qty || 0);
  return getDiscountAmountPerUnit(mrp, discountPct) * safeQty;
}

export function getLineAmountAfterDiscount(mrp: number, qty: number, discountPct: number) {
  const safeQty = Number(qty || 0);
  return getPerUnitPriceAfterDiscount(mrp, discountPct) * safeQty;
}

// --- Amount in words (Indian numbering: crore / lakh / thousand) ---
const WORD_ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const WORD_TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function twoDigitWords(n: number): string {
  if (n < 20) return WORD_ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return WORD_TENS[t] + (o ? " " + WORD_ONES[o] : "");
}

function threeDigitWords(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let s = "";
  if (h) s += WORD_ONES[h] + " Hundred";
  if (r) s += (s ? " " : "") + twoDigitWords(r);
  return s;
}

export function numberToIndianWords(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);

  let words: string;
  if (rupees === 0) {
    words = "Zero";
  } else {
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const rest = rupees % 1000;
    const parts: string[] = [];
    if (crore) parts.push(threeDigitWords(crore) + " Crore");
    if (lakh) parts.push(twoDigitWords(lakh) + " Lakh");
    if (thousand) parts.push(twoDigitWords(thousand) + " Thousand");
    if (rest) parts.push(threeDigitWords(rest));
    words = parts.join(" ");
  }

  let result = `Rupees ${words}`;
  if (paise > 0) result += ` and ${twoDigitWords(paise)} Paise`;
  return result + " Only";
}