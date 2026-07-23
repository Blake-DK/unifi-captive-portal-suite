import { z } from "zod";

export function onlyDigits(value: string): string {
  return (value ?? "").replace(/\D+/g, "");
}

export function isValidPhone(raw: string): boolean {
  const digits = onlyDigits(raw);
  // US: 10 digits; UK: 11 digits (starting 07...) or 10 mobile digits
  return digits.length === 10 || digits.length === 11;
}

// Whether a building is required depends on which Location row was picked
// (a DB lookup), so that check lives server-side in
// resolveLocationForRegistration() rather than in this static schema.
export const guestRegistrationSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60, "Name too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(60, "Name too long"),
  phone: z.string().refine(isValidPhone, "Please enter a valid US or UK phone number"),
  // Required only when email verification is enabled — that depends on
  // settings, so the check lives server-side in the authorize route.
  email: z.string().trim().max(120, "Email too long").email("Invalid email").optional().or(z.literal("")),
  voucher: z.string().trim().max(32, "Voucher code too long").optional().or(z.literal("")),
  locationId: z.number().int().positive().optional().nullable(),
  building: z.string().trim().max(80).optional(),
  roomNumber: z.string().trim().max(40).optional(),
  acceptTerms: z.literal(true, "You must accept the terms to continue"),
  // UniFi redirect parameters
  mac: z.string().min(1, "MAC address missing"),
  apMac: z.string().optional().nullable(),
  ssid: z.string().optional().nullable(),
  site: z.string().optional().nullable(),
  originalUrl: z.string().optional().nullable(),
});

export type GuestRegistrationInput = z.infer<typeof guestRegistrationSchema>;

// Guest "My Info" edit — deliberately excludes phone (the login identity
// anchor) and all the captive-portal-flow-specific fields above.
export const guestProfileUpdateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60, "Name too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(60, "Name too long"),
  email: z.string().trim().max(120, "Email too long").email("Invalid email").optional().or(z.literal("")),
});

export type GuestProfileUpdateInput = z.infer<typeof guestProfileUpdateSchema>;

// Admin-initiated "create user" — a staff member is creating a person's
// first device record without any UniFi-redirect context, so acceptTerms /
// originalUrl don't apply and the location is fully optional.
export const adminCreateUserSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60, "Name too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(60, "Name too long"),
  phone: z.string().refine(isValidPhone, "Please enter a valid US or UK phone number"),
  email: z.string().trim().max(120, "Email too long").email("Invalid email").optional().or(z.literal("")),
  mac: z.string().min(1, "MAC address is required"),
  label: z.string().trim().max(40, "Label too long").optional(),
  locationId: z.number().int().positive().optional().nullable(),
  building: z.string().trim().max(80).optional(),
  roomNumber: z.string().trim().max(40).optional(),
});

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
