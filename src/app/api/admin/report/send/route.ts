import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getMailSettings, isMailConfigured, sendMail } from "@/lib/mailer";
import {
  buildSummaryData,
  renderSummaryEmail,
  reportPeriod,
  type ReportFrequency,
} from "@/lib/summaryReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send the summary report now, covering the period the configured frequency
 * would cover. Doesn't touch reportLastSentAt — a manual send must never
 * suppress the scheduled one. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  const freq = (["daily", "weekly", "monthly"] as const).includes(
    (s?.reportFrequency ?? "") as ReportFrequency,
  )
    ? (s!.reportFrequency as ReportFrequency)
    : "weekly";
  const to = (s?.reportEmail ?? "").trim() || (s?.alertEmail ?? "").trim();
  if (!to) return NextResponse.json({ error: "No recipient — set one first" }, { status: 400 });
  const mail = await getMailSettings();
  if (!isMailConfigured(mail)) {
    return NextResponse.json({ error: "Email is not configured" }, { status: 503 });
  }

  const data = await buildSummaryData(reportPeriod(freq, new Date()));
  const rendered = renderSummaryEmail(data, { brand: mail.brandName || "Network", frequency: freq });
  try {
    await sendMail(mail, { to, ...rendered, kind: "report" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    return NextResponse.json({ error: `Send failed: ${message}` }, { status: 502 });
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "report.send_now",
    target: to,
    detail: { frequency: freq, period: data.period.label },
  });
  return NextResponse.json({ ok: true, to, period: data.period.label });
}
