import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { getSystemSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Guest-facing privacy notice. Renders the controller's custom notice if one is
 * set in Settings → Portal, otherwise a built-in template grounded in the data
 * the portal actually collects. This is the transparency disclosure required
 * alongside (not replaced by) the terms of use.
 */
function defaultNotice(brand: string, contact: string): string {
  return `# Privacy notice

**${brand}** operates this guest WiFi service and is the data controller for the
personal data described below. This notice explains what we collect, why, how
long we keep it, and your rights.

## What we collect
- **Registration details** you provide: name, phone number, and (where required)
  email address and any additional fields the sign-up form requests.
- **Device and connection data**: your device's network (MAC) address, the
  access point and network name, your assigned IP address, browser/user-agent,
  and the location/area you connected from.
- **Usage data**: connection times, session duration, and volume of data
  transferred. Traffic is categorised by **application/service type only** (not
  the content of your browsing) for capacity and security purposes, visible only
  to authorised administrators.

## Why we use it
To provide and manage your network access (a service you request), to verify a
reachable contact where enabled, and to keep the network secure and operational.

## How long we keep it
We retain registration and usage data only as long as needed to provide the
service and meet our security and legal obligations, after which identifying
details are anonymised or deleted according to our retention policy.

## Who we share it with
We use service providers acting on our behalf — an email delivery provider (for
verification and notification emails) and our network/reverse-proxy
infrastructure. We do not sell your data or use it for advertising.

## Your rights
You may request access to the data we hold about you, correction of inaccurate
data, or its erasure, and you may object to or ask us to restrict certain
processing. To exercise any of these rights${contact ? `, contact **${contact}**` : ", contact the venue staff or the network operator"}.

You also have the right to complain to your local data protection authority.`;
}

export default async function PrivacyNoticePage() {
  const settings = await getSystemSettings();
  const brand = settings.brandName || "This network";
  const body = settings.privacyNotice?.trim()
    ? settings.privacyNotice
    : defaultNotice(brand, settings.privacyContact?.trim() || "");

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <article className="text-sm text-foreground">
        <ReactMarkdown
          components={{
            h1: ({ node, ...props }) => <h1 className="mb-4 text-2xl font-bold" {...props} />,
            h2: ({ node, ...props }) => <h2 className="mb-2 mt-6 text-lg font-semibold" {...props} />,
            p: ({ node, ...props }) => <p className="mb-4 leading-relaxed" {...props} />,
            ul: ({ node, ...props }) => <ul className="mb-4 list-disc space-y-1 pl-5" {...props} />,
            li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
            strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
          }}
        >
          {body}
        </ReactMarkdown>
      </article>
      <div className="mt-8 border-t pt-4 text-sm">
        <Link href="/portal" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
          ← Back to sign-in
        </Link>
      </div>
    </main>
  );
}
