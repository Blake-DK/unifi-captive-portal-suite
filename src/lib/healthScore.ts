/**
 * A single 0–100 network-health rollup for the dashboard, so "is today a bad
 * day" doesn't require reading three pages. Pure and testable: the dashboard
 * gathers the inputs (open alerts, offline devices, unhealthy subsystems) and
 * this turns them into a score + band. Deductions are capped so one noisy
 * category can't dominate, and the whole thing is clamped to [0, 100].
 */

export type HealthInputs = {
  errorAlerts: number;
  warningAlerts: number;
  offlineDevices: number;
  badSubsystems: number;
};

export type HealthBand = "good" | "fair" | "poor";

export type HealthScore = {
  score: number;
  band: HealthBand;
  label: string;
};

export function scoreNetworkHealth(i: HealthInputs): HealthScore {
  const deduction =
    Math.min(60, i.errorAlerts * 12) +
    Math.min(30, i.warningAlerts * 4) +
    Math.min(40, i.offlineDevices * 8) +
    Math.min(30, i.badSubsystems * 10);
  const score = Math.max(0, Math.min(100, 100 - deduction));
  const band: HealthBand = score >= 85 ? "good" : score >= 60 ? "fair" : "poor";
  const label = band === "good" ? "Healthy" : band === "fair" ? "Degraded" : "Unhealthy";
  return { score, band, label };
}
