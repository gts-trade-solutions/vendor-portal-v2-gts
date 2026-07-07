"use client";

import { useEffect, useRef, useState } from "react";
import type { InvoiceAddress } from "./QuickAddAddressDialog";

// Searchable bill-to address picker. Replaces a plain <select> so the user can
// type any part of the label / customer name / city / pincode to jump straight
// to the matching saved address (type-ahead), instead of only the native
// first-letter option jump.
export function AddressSearchSelect({
  addresses,
  value,
  onSelect,
  placeholder = "Search saved address…",
}: {
  addresses: InvoiceAddress[];
  value: string;
  onSelect: (id: string, addr: InvoiceAddress | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = addresses.find((a) => a.id === value) || null;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? addresses.filter((a) =>
        [a.label, a.name, a.city, a.state, a.pincode, a.gstin]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q)),
      )
    : addresses;

  const choose = (a: InvoiceAddress | null) => {
    onSelect(a?.id ?? "", a);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        className="w-full rounded-md border px-3 py-2 text-sm"
        placeholder={placeholder}
        value={
          open ? query : selected ? `${selected.label} — ${selected.city}` : ""
        }
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && filtered[highlight]) choose(filtered[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-background shadow-lg">
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(null)}
          >
            (Clear selection)
          </button>
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No matching address
            </div>
          )}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                i === highlight ? "bg-muted" : ""
              }`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(a)}
            >
              <span className="font-medium">{a.label}</span> — {a.city}
              {a.name ? (
                <span className="text-muted-foreground"> · {a.name}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
