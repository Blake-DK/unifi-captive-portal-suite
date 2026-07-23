import { prisma } from "./prisma";

export type GuestProfile = {
  firstName: string;
  lastName: string;
  email: string | null;
};

/**
 * Not filtered to active rows: a guest with zero active devices (all
 * revoked, but still holding a valid 24h session) should still be able to
 * see/edit their info, not get redirected out as if they were logged out.
 */
export async function getProfileForPhone(phone: string): Promise<GuestProfile | null> {
  const row = await prisma.guestRegistration.findFirst({
    where: { phone, anonymizedAt: null },
    orderBy: { authorizedAt: "desc" },
    select: { firstName: true, lastName: true, email: true },
  });
  return row;
}

/**
 * Applies to every active row for the phone, not just the latest one:
 * self-service login matches phone+lastName against whichever row is most
 * recent, and every active device row should show consistent identity info.
 * Falls back to the single most recent row overall when there are no active
 * ones, so an edit never silently no-ops for a guest with zero devices.
 */
export async function updateProfileForPhone(
  phone: string,
  data: GuestProfile,
): Promise<number> {
  // Changing the email invalidates any previous verification — the new
  // address hasn't proven anything yet.
  const current = await prisma.guestRegistration.findFirst({
    where: { phone, anonymizedAt: null },
    orderBy: { authorizedAt: "desc" },
    select: { email: true },
  });
  const emailChanged =
    (current?.email ?? "").toLowerCase() !== (data.email ?? "").toLowerCase();
  const updateData = emailChanged ? { ...data, emailVerifiedAt: null } : data;

  const result = await prisma.guestRegistration.updateMany({
    where: { phone, revokedAt: null },
    data: updateData,
  });
  if (result.count > 0) return result.count;

  const latest = await prisma.guestRegistration.findFirst({
    where: { phone },
    orderBy: { authorizedAt: "desc" },
  });
  if (!latest) return 0;
  await prisma.guestRegistration.update({ where: { id: latest.id }, data: updateData });
  return 1;
}
