'use client';

import VendorGate from "@/components/vendor/VendorGate";


export default function VendorProtectedLayout({
  children,
}: { children: React.ReactNode }) {
  return <VendorGate>{children}</VendorGate>;
}
