const PLATFORMS: { name: string; steps: string[] }[] = [
  {
    name: "Xbox",
    steps: [
      "Press the Xbox button to open the guide.",
      "Go to Settings → General → Network settings.",
      "Select Advanced settings — the wired or wireless MAC address is listed there.",
    ],
  },
  {
    name: "PlayStation",
    steps: [
      "Go to Settings → Network → Settings.",
      "Select View Connection Status.",
      "The MAC Address is listed near the bottom of the status screen.",
    ],
  },
  {
    name: "Nintendo Switch",
    steps: [
      "From the HOME menu, go to System Settings → Internet.",
      "Select Internet Settings.",
      "Choose your network, then press the (X) button (or the info icon) to see the MAC address.",
    ],
  },
  {
    name: "Smart TV / streaming box",
    steps: [
      "Look under Settings → Network → About / Status (menu names vary by brand).",
      "The MAC address is usually shown alongside the IP address, labelled Wi-Fi MAC or Wireless MAC.",
    ],
  },
];

export function MacAddressHelp() {
  return (
    <details className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none font-medium text-foreground">
        Can&apos;t find your device&apos;s MAC address?
      </summary>
      <div className="mt-2 space-y-2">
        {PLATFORMS.map((p) => (
          <details key={p.name} className="rounded border bg-background p-2">
            <summary className="cursor-pointer select-none font-medium">{p.name}</summary>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              {p.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </details>
        ))}
        <p className="pt-1">
          Still stuck? Check your device&apos;s Wi-Fi/network settings for &quot;Wi-Fi MAC
          Address&quot;, or your home router&apos;s connected-devices list — it&apos;s usually
          labelled MAC, Physical Address, or Hardware Address.
        </p>
      </div>
    </details>
  );
}
