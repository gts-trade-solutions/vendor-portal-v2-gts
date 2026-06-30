export const LEGACY_UNIT_SUFFIX_REGEX = /-\d{3}$/;

export type InventoryCodeMode = "legacy_exact" | "shared_scan";

export type InventoryCodeLike = {
  unit_code?: string | null;
  scan_code?: string | null;
};

function cleanCode(value?: string | null) {
  return (value ?? "").trim();
}

export function hasLegacySequenceSuffix(code?: string | null) {
  return LEGACY_UNIT_SUFFIX_REGEX.test(cleanCode(code));
}

export function stripLegacySequenceSuffix(code?: string | null) {
  return cleanCode(code).replace(LEGACY_UNIT_SUFFIX_REGEX, "");
}

export function getInventoryCodeMode(codeLike?: InventoryCodeLike | null): InventoryCodeMode {
  const scanCode = cleanCode(codeLike?.scan_code);
  const unitCode = cleanCode(codeLike?.unit_code);

  if (scanCode && unitCode && scanCode !== unitCode) {
    return "shared_scan";
  }

  return "legacy_exact";
}

export function getPublicScanCode(codeLike?: InventoryCodeLike | null) {
  const scanCode = cleanCode(codeLike?.scan_code);
  if (scanCode) return scanCode;

  const unitCode = cleanCode(codeLike?.unit_code);
  if (!unitCode) return "";

  return hasLegacySequenceSuffix(unitCode)
    ? stripLegacySequenceSuffix(unitCode)
    : unitCode;
}

export function formatSharedBatchPreview(scanCode?: string | null, count?: number | null) {
  const base = cleanCode(scanCode);
  const qty = Number.isFinite(Number(count)) ? Number(count) : 0;

  if (!base) return "";
  if (qty <= 1) return base;

  return `${base} (${qty} units)`;
}

export function sortUnitsForAllocation<T extends { created_at?: string | null; unit_code?: string | null; id?: string | null }>(
  rows: T[]
) {
  return [...rows].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;

    if (aTime !== bTime) return aTime - bTime;

    const aCode = cleanCode(a.unit_code);
    const bCode = cleanCode(b.unit_code);
    if (aCode !== bCode) return aCode.localeCompare(bCode);

    return cleanCode(a.id).localeCompare(cleanCode(b.id));
  });
}
