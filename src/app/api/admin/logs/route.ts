import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toCSV } from "@/lib/csv";
import { jsonSafe } from "@/lib/utils";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const from = sp.get("from");
  const to = sp.get("to");
  const format = sp.get("format");
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10)));

  const where: Prisma.GuestRegistrationWhereInput = {};
  if (q) {
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
    ];
  }
  if (from || to) {
    where.authorizedAt = {};
    if (from) where.authorizedAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.authorizedAt.lte = new Date(`${to}T23:59:59`);
  }

  if (format === "csv") {
    const rows = await prisma.guestRegistration.findMany({
      where,
      orderBy: { authorizedAt: "desc" },
      take: 10000,
    });
    const csv = toCSV(
      rows.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        phone: r.phone,
        locationType: r.locationType,
        location: r.locationName
          ? [r.locationName, [r.building, r.roomNumber].filter(Boolean).join(" / Rm ")]
              .filter(Boolean)
              .join(" — ")
          : r.locationType === "base"
            ? (r.baseLocation ?? "")
            : [r.building, r.roomNumber].filter(Boolean).join(" / Rm "),
        mac: r.macAddress,
        ssid: r.ssid ?? "",
        authorizedAt: r.authorizedAt.toISOString(),
      })),
      [
        { key: "id", header: "ID" },
        { key: "firstName", header: "First Name" },
        { key: "lastName", header: "Last Name" },
        { key: "phone", header: "Phone" },
        { key: "locationType", header: "Type" },
        { key: "location", header: "Location" },
        { key: "mac", header: "MAC" },
        { key: "ssid", header: "SSID" },
        { key: "authorizedAt", header: "Authorised At" },
      ],
    );
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="logs-${Date.now()}.csv"`,
      },
    });
  }

  const [total, rows] = await Promise.all([
    prisma.guestRegistration.count({ where }),
    prisma.guestRegistration.findMany({
      where,
      orderBy: { authorizedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json(jsonSafe({ total, rows, page, pageSize }));
}
