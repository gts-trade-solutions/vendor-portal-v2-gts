import Link from "next/link";
import {
  Package,
  Bell,
  FileText,
  BarChart3,
  ShoppingCart,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

const FEATURES = [
  {
    icon: Package,
    title: "Inventory",
    desc: "Unit-level stock with scan codes, batches and status tracking.",
  },
  {
    icon: Bell,
    title: "Expiry Alerts",
    desc: "Spot expiring and expired stock within your alert window.",
  },
  {
    icon: FileText,
    title: "Invoices",
    desc: "GST invoices with payments, partial dues and outstanding.",
  },
  {
    icon: BarChart3,
    title: "Reports",
    desc: "Sales, outstanding by company and brand-wise stock value.",
  },
  {
    icon: ShoppingCart,
    title: "Products",
    desc: "Edit details, pricing, HSN and storefront visibility.",
  },
  {
    icon: ShieldCheck,
    title: "Team Roles",
    desc: "Admin and view-only access for your staff.",
  },
];

const TRUST = [
  "GST-ready invoices",
  "Unit-level inventory",
  "Automatic stock revert",
  "Payment & outstanding tracking",
];

export default function Home() {
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-700 text-sm font-bold text-primary-foreground shadow-sm">
              MK
            </div>
            <div className="leading-tight">
              <div className="font-semibold">MadenKorea</div>
              <div className="text-xs text-muted-foreground">Vendor Portal</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/vendor/login"
              className="hidden h-10 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent sm:inline-flex"
            >
              Vendor Login
            </Link>
            <Link
              href="/vendor"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Left */}
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              Vendor workspace is live
            </div>

            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Manage products, stock &amp; expiry{" "}
              <span className="bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                in one place
              </span>
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              The MadenKorea Vendor Portal brings inventory, GST invoicing,
              payments and reporting together — so you always know what&apos;s in
              stock, what&apos;s expiring, and what&apos;s owed.
            </p>

            {/* CTAs */}
            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
              <Link
                href="/vendor"
                className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:w-auto"
              >
                Open Vendor Dashboard
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>

              <Link
                href="/vendor/login"
                className="inline-flex h-12 w-full items-center justify-center rounded-md border bg-background px-6 text-sm font-semibold transition-colors hover:bg-accent sm:w-auto"
              >
                Login / Register
              </Link>
            </div>

            {/* Trust row */}
            <div className="flex flex-wrap gap-2 pt-2">
              {TRUST.map((t) => (
                <span
                  key={t}
                  className="rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Right card */}
          <div className="rounded-2xl border bg-card p-6 shadow-lg shadow-primary/5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">What you can do</div>
              <div className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                Vendor tools
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="group rounded-xl border bg-background p-4 transition-all hover:border-primary/40 hover:shadow-sm"
                >
                  <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>© {year} MadenKorea — Vendor Portal</div>
          <div className="flex gap-4">
            <Link href="/vendor/login" className="hover:text-foreground hover:underline">
              Login
            </Link>
            <Link href="/vendor" className="hover:text-foreground hover:underline">
              Dashboard
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
