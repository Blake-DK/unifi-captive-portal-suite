import { redirect } from "next/navigation";
import { getAdminSession, sessionCanViewTraffic } from "@/lib/adminSession";
import { TrafficReport } from "@/components/admin/TrafficReport";

export const dynamic = "force-dynamic";

export default async function TrafficPage() {
  const session = await getAdminSession();
  if (!(await sessionCanViewTraffic(session))) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Traffic</h1>
        <p className="text-sm text-muted-foreground">
          What guests are using the network for — apps and categories identified by the
          UniFi gateway&apos;s traffic inspection.
        </p>
      </div>
      <TrafficReport />
    </div>
  );
}
