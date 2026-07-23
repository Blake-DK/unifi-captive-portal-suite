import { cookies } from "next/headers";
import { ADMIN_COOKIE, SENTINEL_SUBS, verifyAdminSession, type AdminSession } from "./auth";
import { prisma } from "./prisma";

/** Session for server components (pages/layouts); proxy.ts already gates access. */
export async function getAdminSession(): Promise<AdminSession | null> {
  return verifyAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
}

/** Whether this session's account holds the per-guest traffic-data grant. */
export async function sessionCanViewTraffic(session: AdminSession | null): Promise<boolean> {
  if (!session || SENTINEL_SUBS.includes(session.sub)) return false;
  const user = await prisma.adminUser.findUnique({
    where: { username: session.sub },
    select: { canViewTraffic: true },
  });
  return user?.canViewTraffic === true;
}
