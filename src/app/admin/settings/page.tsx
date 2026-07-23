import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const categories = [
  { href: "/admin/settings/branding", title: "Branding", description: "Name, images, colours, welcome text, terms, and privacy notice" },
  { href: "/admin/settings/locations", title: "Locations", description: "Registration locations, buildings, logos, and data retention" },
  { href: "/admin/settings/guest-defaults", title: "Guest Defaults", description: "Session duration, speed limits, and self-service device cap" },
  { href: "/admin/settings/urls", title: "URLs", description: "Portal, guest, and admin URLs, plus the Traefik reverse proxy and its resources" },
  { href: "/admin/settings/unifi", title: "UniFi", description: "Controller connection, portal setup, and hotspot configuration" },
  { href: "/admin/settings/monitoring", title: "Monitoring", description: "Network alerts, metric history, and device SSH debugging" },
  { href: "/admin/settings/email", title: "Email", description: "Guest email verification, SMTP server, and email design" },
  { href: "/admin/settings/admins", title: "Admins", description: "Admin accounts, roles, and 2FA resets" },
];

export default function SettingsIndexPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {categories.map((c) => (
        <Link key={c.href} href={c.href} className="h-full">
          <Card className="h-full transition-colors hover:border-primary">
            <CardHeader>
              <CardTitle>{c.title}</CardTitle>
              <CardDescription>{c.description}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        </Link>
      ))}
    </div>
  );
}
