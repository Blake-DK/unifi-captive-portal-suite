import type { Metadata } from "next";
import { headers } from "next/headers";
import { getSystemSettings } from "@/lib/settings";
import { getBuildInfo } from "@/lib/version";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSystemSettings();
  return {
    // Template keeps every tab title branded ("Page · Brand") without each
    // page repeating the brand name itself.
    title: { default: settings.brandName, template: `%s · ${settings.brandName}` },
    description: `${settings.brandName} — guest WiFi portal and network operations, powered by UniFi`,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSystemSettings();
  // Set per-request by src/proxy.ts; the CSP only trusts scripts/styles
  // carrying it, so both inline blocks below must wear it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the theme before first paint (no flash). "system" (default)
            follows prefers-color-scheme; the toggle stores light/dark/system. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||((!t||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})()`,
          }}
        />
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: `
          :root {
            --primary: ${settings.primaryColor};
            --primary-foreground: 210 40% 98%;
          }
          .bg-primary { background-color: var(--primary) !important; }
          .text-primary { color: var(--primary) !important; }
          .border-primary { border-color: var(--primary) !important; }
          .ring-primary { --tw-ring-color: var(--primary) !important; }
          .bg-primary:hover { filter: brightness(0.9); }
        ` }} />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        {getBuildInfo().channel !== "stable" && (
          // Same height for both channels (py-1 + text-xs = 1.5rem) — the
          // admin layout's sticky offsets are keyed to it.
          <div
            className={`sticky top-0 z-50 py-1 text-center text-xs font-medium ${
              getBuildInfo().channel === "nightly" ? "bg-red-500 text-white" : "bg-amber-400 text-black"
            }`}
          >
            {getBuildInfo().channel === "nightly"
              ? `Nightly ${getBuildInfo().nightlyVersion} (${getBuildInfo().shortSha}${
                  getBuildInfo().builtAt
                    ? `, built ${new Date(getBuildInfo().builtAt!).toISOString().slice(0, 16).replace("T", " ")} UTC`
                    : ""
                }) — ungated, straight from the nightly branch`
              : `Development build v${getBuildInfo().version} (${getBuildInfo().shortSha}) — running the develop branch`}
          </div>
        )}
        <div className="flex-1">{children}</div>
        <footer className="py-3 text-center text-[11px] text-muted-foreground/70">
          Developed and built by Alex Blake
        </footer>
      </body>
    </html>
  );
}
