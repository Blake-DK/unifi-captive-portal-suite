/**
 * Runbook catalog, importable from client components (no server-only deps).
 * The implementations live in ./runbooks (server-side).
 */

export type StepStatus = "pass" | "warn" | "fail" | "info";

export type RunbookStep = {
  status: StepStatus;
  title: string;
  detail?: string;
  fix?: string;
};

export type RunbookMeta = {
  id: string;
  title: string;
  description: string;
  input?: { label: string; placeholder: string };
};

export const RUNBOOKS: RunbookMeta[] = [
  {
    id: "guest-cant-connect",
    title: "A guest can't get online",
    description:
      "Follows one guest end-to-end: registration on file, expiry/revocation, email verification, device cap, live WiFi association, and controller authorization.",
    input: { label: "Guest phone number or device MAC", placeholder: "+45... or aa:bb:cc:dd:ee:ff" },
  },
  {
    id: "device-offline",
    title: "A network device is offline or unhealthy",
    description:
      "Checks every adopted AP, switch, and gateway for offline/adoption states, recent reboots, and resource pressure, with per-state recovery steps.",
  },
  {
    id: "vlan-trunking",
    title: "Guest VLAN / trunking check",
    description:
      "Traces every AP's wired uplink path to the gateway and verifies each guest SSID's VLAN is carried on every switch port along the way — catches excluded VLANs, access-port misconfigurations, and disabled trunk ports.",
  },
  {
    id: "portal-not-redirecting",
    title: "The captive portal doesn't pop up",
    description:
      "Verifies the UniFi hotspot configuration, guest SSID policy, and that the captive URL actually answers, then lists the client-side gotchas.",
  },
  {
    id: "controller-unreachable",
    title: "The UniFi controller is unreachable",
    description:
      "Tests connectivity and login to the controller and classifies the failure: network/DNS, TLS trust, credentials, or permissions.",
  },
];
