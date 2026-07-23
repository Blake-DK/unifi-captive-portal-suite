import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { checkAdminAccessFromHeaders } from "@/lib/adminHost";
import { LayoutDashboard, ListOrdered, Wifi, Users, LogOut, Palette, Eye, Activity, ScrollText, HeartPulse, Wrench, Ticket, Share2, CalendarClock, BellRing, LineChart, Smartphone, History, Cable, Siren, RadioTower, Router, ShieldAlert, ShieldCheck, PlugZap, FileClock, Gauge } from "lucide-react";
import { getAdminSession, sessionCanViewTraffic } from "@/lib/adminSession";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ClientWindowsProvider } from "@/components/admin/ClientWindows";
import { DeviceWindowsProvider } from "@/components/admin/DeviceWindows";
import { ChangelogPopup } from "@/components/admin/ChangelogPopup";
import { prisma } from "@/lib/prisma";
import { getBuildInfo } from "@/lib/version";
import { getCachedVersionStatus } from "@/lib/updateCheck";
import { logdashProfileActive } from "@/lib/portalMode";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean; trafficOnly?: boolean };
type NavGroup = { label?: string; items: NavItem[] };

// Grouped so the sidebar reads as sections instead of one long flat list.
const navGroups: NavGroup[] = [
  {
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Guests",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/sessions", label: "Sessions", icon: Wifi },
      { href: "/admin/logs", label: "Logs", icon: ListOrdered },
      { href: "/admin/vouchers", label: "Vouchers", icon: Ticket },
      { href: "/admin/events", label: "Events", icon: CalendarClock },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { href: "/admin/status", label: "Site health", icon: HeartPulse },
      { href: "/admin/issues", label: "Issues", icon: Siren },
      { href: "/admin/alerts", label: "Alerts", icon: BellRing },
      { href: "/admin/metrics", label: "Metrics", icon: LineChart },
      { href: "/admin/timeline", label: "Timeline", icon: History },
      { href: "/admin/traffic", label: "Traffic", icon: Activity, trafficOnly: true },
    ],
  },
  {
    label: "Devices",
    items: [
      { href: "/admin/map", label: "Map", icon: Share2 },
      { href: "/admin/aps", label: "Access Points", icon: RadioTower },
      { href: "/admin/ports", label: "Switch Ports", icon: Cable },
      { href: "/admin/clients", label: "Clients", icon: Smartphone },
      { href: "/admin/troubleshoot", label: "Troubleshoot", icon: Wrench },
    ],
  },
  {
    label: "Security",
    items: [
      { href: "/admin/rogue-aps", label: "Rogue APs", icon: ShieldAlert },
      { href: "/admin/rogue-unifi", label: "Rogue UniFi", icon: PlugZap },
      { href: "/admin/extenders", label: "Extenders", icon: Router },
      { href: "/admin/network-review", label: "Network Review", icon: ShieldCheck, adminOnly: true },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/config-history", label: "Config history", icon: FileClock, adminOnly: true },
      { href: "/admin/audit", label: "Audit", icon: ScrollText, adminOnly: true },
      { href: "/admin/load-test", label: "Load test", icon: Gauge, adminOnly: true },
      { href: "/admin/settings", label: "Settings", icon: Palette, adminOnly: true },
    ],
  },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Surface isolation: on any hostname other than the configured admin host
  // (or from outside the management networks) the admin pages don't exist —
  // same policy the API routes enforce in requireAdmin.
  if ((await checkAdminAccessFromHeaders(await headers())) !== null) notFound();

  const session = await getAdminSession();

  // Logged out (the /admin/login page): render standalone with no sidebar or
  // admin chrome — the login page provides its own full-screen centred layout.
  if (!session) return <>{children}</>;

  const isMonitor = session?.role === "monitor";
  const canTraffic = await sessionCanViewTraffic(session);
  const brandName = await prisma.systemSettings
    .findUnique({ where: { id: "config" }, select: { brandName: true } })
    .then((s) => s?.brandName || "Guest Portal")
    .catch(() => "Guest Portal");
  const build = getBuildInfo();
  // Cache-only read (never blocks the render); shows the update badge once
  // the hourly check has an answer.
  const versionStatus = getCachedVersionStatus();
  // Sidebar link to the optional Traefik log dashboard (own hostname, own
  // basic-auth sign-in) — only when its compose profile + host are set.
  const logdashHost = (process.env.LOGDASH_HOST ?? "").trim();
  // Straight to /dashboard — the app's root is a landing page, not the data.
  const logdashUrl =
    logdashProfileActive() && logdashHost ? `https://${logdashHost}/dashboard` : null;
  const visible = (it: NavItem) =>
    !(it.adminOnly && session?.role !== "admin") && !(it.trafficOnly && !canTraffic);
  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter(visible) }))
    .filter((g) => g.items.length > 0);
  const flatNav = groups.flatMap((g) => g.items);
  // The channel banner (root layout, develop + nightly) is a 1.5rem sticky
  // element above this shell; sticky children must pin below it or they slide
  // by its height while the page scrolls past it. Keep the offset in sync
  // with the banner (py-1 + text-xs = 1.5rem).
  const devBanner = build.channel !== "stable";

  // data-admin-shell: globals.css hides the root layout's credit footer on
  // admin pages — its extra scroll range dragged the sticky sidebar.
  return (
    <div data-admin-shell className="flex min-h-screen flex-col bg-muted/40 md:flex-row">
      {/* Phone: compact top bar — the sidebar below only exists on md+. */}
      <header className={`sticky ${devBanner ? "top-6" : "top-0"} z-20 border-b bg-card md:hidden`}>
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="text-base font-bold">{brandName}</h2>
          <div className="flex items-center gap-3">
            <ThemeToggle className="flex items-center gap-1 text-xs text-muted-foreground [&>span]:hidden" />
            {session && (
              <Link href="/admin/account" className="flex items-center gap-1 text-xs text-muted-foreground">
                {isMonitor && <Eye className="h-3 w-3" />}
                {session.sub === "setup" ? "setup" : session.sub}
              </Link>
            )}
            <form action="/api/admin/logout" method="post">
              <button type="submit" className="flex items-center text-foreground" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 py-2">
          {flatNav.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              <it.icon className="h-4 w-4" />
              {it.label}
            </Link>
          ))}
        </nav>
      </header>

      <aside
        className={`sticky hidden w-64 shrink-0 flex-col border-r bg-card p-6 md:flex ${
          devBanner ? "top-6 h-[calc(100vh-1.5rem)]" : "top-0 h-screen"
        }`}
      >
        <div className="mb-8">
          <h2 className="text-lg font-bold">{brandName}</h2>
          <p className="text-xs text-muted-foreground">Admin panel</p>
          <p
            className="mt-0.5 font-mono text-[10px] text-muted-foreground/70"
            title={`v${build.version} · commit ${build.sha}${build.builtAt ? ` — built ${build.builtAt}` : ""}`}
          >
            v{build.version} · {build.shortSha}
            {build.builtAt ? ` · ${new Date(build.builtAt).toLocaleDateString("en-GB")}` : ""}
          </p>
          {versionStatus.upToDate === false && versionStatus.latest && (
            <p className="mt-1 w-fit rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              {/* Nightly "versions" are commit SHAs — no v prefix. */}
              Update available: {versionStatus.channel === "nightly" ? "" : "v"}
              {versionStatus.latest.version} — run ./update.sh
            </p>
          )}
        </div>
        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {groups.map((g, gi) => (
            <div key={g.label ?? gi} className="space-y-1">
              {g.label && (
                <p className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {g.label}
                </p>
              )}
              {g.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <it.icon className="h-4 w-4" />
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="space-y-2">
          {logdashUrl && (
            <a
              href={logdashUrl}
              target="_blank"
              rel="noreferrer"
              title="Traefik access-log analytics — signs in with your portal account"
              className="flex w-full items-center gap-3 rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:underline"
            >
              <ScrollText className="h-3 w-3" /> Traefik log dashboard
            </a>
          )}
          <ThemeToggle className="flex w-full items-center gap-3 rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted" />
          {session && (
            <Link
              href="/admin/account"
              title="My account — two-factor authentication"
              className="flex items-center gap-2 rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:underline"
            >
              {isMonitor && <Eye className="h-3 w-3" />}
              {session.sub === "setup" ? "first-time setup" : session.sub}
              {isMonitor ? " (view-only)" : session.role === "operator" ? " (operator)" : ""}
            </Link>
          )}
          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <LogOut className="h-4 w-4" /> Sign Out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-10">
        <ClientWindowsProvider>
          {/* Device windows are inside the client-window provider so a device
              window can open a connected client's window. */}
          <DeviceWindowsProvider>{children}</DeviceWindowsProvider>
        </ClientWindowsProvider>
      </main>
      <ChangelogPopup />
    </div>
  );
}
