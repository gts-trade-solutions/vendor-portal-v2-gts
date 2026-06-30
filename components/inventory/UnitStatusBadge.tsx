"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type InventoryStatus =
  | "IN_STOCK"
  | "INVOICED"
  | "DEMO"
  | "SOLD"
  | "RETURNED"
  | "OUT_OF_STOCK";

export function UnitStatusBadge({
  status,
  expired = false,
  className,
}: {
  status: InventoryStatus;
  expired?: boolean;
  className?: string;
}) {
  const label = (() => {
    switch (status) {
      case "IN_STOCK":
        return "In stock";
      case "INVOICED":
        return "Invoiced";
      case "DEMO":
        return "Demo";
      case "SOLD":
        return "Sold";
      case "RETURNED":
        return "Returned";
      case "OUT_OF_STOCK":
        return "Out of stock";
      default:
        return status;
    }
  })();

  const tone = (() => {
    switch (status) {
      case "IN_STOCK":
        return "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800";
      case "INVOICED":
        return "bg-blue-100 text-blue-900 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800";
      case "DEMO":
        return "bg-purple-100 text-purple-900 border-purple-200 dark:bg-purple-950 dark:text-purple-200 dark:border-purple-800";
      case "SOLD":
        return "bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700";
      case "RETURNED":
        return "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800";
      case "OUT_OF_STOCK":
        return "bg-red-100 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800";
      default:
        return "bg-muted text-foreground border-border";
    }
  })();

  const dot = (() => {
    switch (status) {
      case "IN_STOCK":
        return "bg-emerald-600";
      case "INVOICED":
        return "bg-blue-600";
      case "DEMO":
        return "bg-purple-600";
      case "SOLD":
        return "bg-slate-600";
      case "RETURNED":
        return "bg-amber-600";
      case "OUT_OF_STOCK":
        return "bg-red-600";
      default:
        return "bg-muted-foreground";
    }
  })();

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <Badge
        variant="outline"
        className={cn(
          "rounded-full px-2.5 py-0.5 text-xs font-medium inline-flex items-center gap-2",
          tone
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", dot)} />
        {label}
      </Badge>

      {expired ? (
        <Badge
          variant="outline"
          className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800"
        >
          Expired
        </Badge>
      ) : null}
    </div>
  );
}
