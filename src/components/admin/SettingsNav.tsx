"use client";
import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Ordered by theme (guest · integrations · monitoring · access) and separated by
// a thin divider, rather than a labelled cluster per group — the labels read as
// redundant next to single-item groups. Network Review and Load test are tools,
// not config, so they live in the sidebar (Security / System), not here.
const groups: { href: string; label: string }[][] = [
  [
    { href: "/admin/settings/branding", label: "Branding" },
    { href: "/admin/settings/locations", label: "Locations" },
    { href: "/admin/settings/guest-defaults", label: "Guest Defaults" },
  ],
  [
    { href: "/admin/settings/unifi", label: "UniFi" },
    { href: "/admin/settings/email", label: "Email" },
    { href: "/admin/settings/urls", label: "URLs" },
  ],
  [{ href: "/admin/settings/monitoring", label: "Monitoring" }],
  [{ href: "/admin/settings/admins", label: "Admins" }],
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b pb-2">
      {groups.map((items, gi) => (
        <Fragment key={items[0].href}>
          {gi > 0 && <span aria-hidden className="mx-1.5 hidden h-5 w-px bg-border sm:inline-block" />}
          {items.map((c) => {
            const active = pathname === c.href;
            return (
              <Link
                key={c.href}
                href={c.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {c.label}
              </Link>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
