import { prisma } from "./prisma";
import type { Location } from "@prisma/client";
import { splitBuildings } from "./buildings";

export { splitBuildings };

export const MAX_LOCATIONS = 12;

export interface PortalLocation {
  id: number;
  name: string;
  logoUrl: string | null;
  buildings: string[];
  /** Guests type the building themselves (required); `buildings` becomes suggestions. */
  buildingFreeText: boolean;
  isHotel: boolean;
}

export async function listLocationsForPortal(): Promise<PortalLocation[]> {
  try {
    const rows = await prisma.location.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    return rows.map((l) => ({
      id: l.id,
      name: l.name,
      logoUrl: l.logoUrl,
      buildings: splitBuildings(l.buildings),
      buildingFreeText: l.buildingFreeText,
      isHotel: l.isHotel,
    }));
  } catch (error) {
    console.error("Error fetching locations:", error);
    return [];
  }
}

export async function listLocationsAdmin(): Promise<Location[]> {
  return prisma.location.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
}

/**
 * Tiered plans: a location can override the site-wide guest defaults; null
 * fields fall through. Every grant point (registration, self-service add/
 * renew, verify upgrade, grace) resolves through here so the plans can't
 * drift apart.
 */
export type EffectivePlan = {
  durationMin: number;
  downKbps?: number;
  upKbps?: number;
  quotaMB?: number;
  maxDevices: number;
};

type PlanDefaults = {
  guestDurationMin: number;
  guestDownKbps: number;
  guestUpKbps: number;
  guestQuotaMB: number;
  maxDevicesPerPhone: number;
};

type PlanOverrides = Pick<
  Location,
  "durationMin" | "downKbps" | "upKbps" | "quotaMB" | "maxDevices"
>;

/** Parse a tiered-plan override field: blank/0/garbage = null = site default. */
export function planInt(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type PlanTopOverride = {
  durationMin?: number | null;
  downKbps?: number | null;
  upKbps?: number | null;
  quotaMB?: number | null;
} | null;

// `top` (e.g. an active event) wins over the location, which wins over the
// site default. Each field falls through independently when unset.
export function planFor(
  cfg: PlanDefaults,
  loc?: PlanOverrides | null,
  top?: PlanTopOverride,
): EffectivePlan {
  const pick = (t: number | null | undefined, l: number | null | undefined, d: number) =>
    t ?? l ?? d;
  return {
    durationMin: pick(top?.durationMin, loc?.durationMin, cfg.guestDurationMin),
    downKbps: pick(top?.downKbps, loc?.downKbps, cfg.guestDownKbps) || undefined,
    upKbps: pick(top?.upKbps, loc?.upKbps, cfg.guestUpKbps) || undefined,
    quotaMB: pick(top?.quotaMB, loc?.quotaMB, cfg.guestQuotaMB) || undefined,
    maxDevices: loc?.maxDevices ?? cfg.maxDevicesPerPhone,
  };
}

export async function planForLocationId(
  cfg: PlanDefaults,
  locationId: number | null | undefined,
): Promise<EffectivePlan> {
  const loc = locationId
    ? await prisma.location.findUnique({ where: { id: locationId } }).catch(() => null)
    : null;
  return planFor(cfg, loc);
}

/**
 * Resolve and validate the location choice for a registration. The rules
 * "a building is required iff the chosen location has buildings configured
 * or free-text building entry on", "a free-text building is any non-empty
 * value, a list building must be on the list", and "a room number is
 * required iff the chosen location is a hotel" live here so the guest
 * portal and the admin create-user flow can't drift.
 */
export async function resolveLocationForRegistration(
  locationId: number | null | undefined,
  building: string | null | undefined,
  roomNumber?: string | null,
): Promise<{ location: Location | null; error?: string }> {
  if (locationId == null) return { location: null };
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) return { location: null, error: "Unknown location" };
  const buildings = splitBuildings(location.buildings);
  if (location.buildingFreeText) {
    if (!building?.trim()) return { location, error: "Please enter your building" };
  } else if (buildings.length > 0) {
    if (!building?.trim()) return { location, error: "Please select a building" };
    if (!buildings.includes(building.trim())) return { location, error: "Unknown building" };
  }
  if (location.isHotel && !roomNumber?.trim()) {
    return { location, error: "Please enter your room number" };
  }
  return { location };
}
