"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * For USB/Bluetooth scanners on PC.
 * Scanners behave like a keyboard: they "type" fast then usually send Enter.
 */
export function ScanBox({
  onScan,
  placeholder = "Scan QR here and press Enter…",
}: {
  onScan: (code: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  // keep focus so scanning is frictionless
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <Input
      ref={ref}
      value={value}
      placeholder={placeholder}
      className="h-11 text-base"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const code = value.trim();
          setValue("");
          if (code) onScan(code);
          requestAnimationFrame(() => ref.current?.focus());
        }
      }}
    />
  );
}
