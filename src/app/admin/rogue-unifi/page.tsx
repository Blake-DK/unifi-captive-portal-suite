import { Card, CardContent } from "@/components/ui/card";
import { RogueUnifiTable } from "@/components/admin/RogueUnifiTable";
import { getAdminSession } from "@/lib/adminSession";

export const dynamic = "force-dynamic";

/**
 * Un-onboarded UniFi hardware: devices the CONTROLLER recognises as its own
 * kind (APs, switches, gateways) but which were never adopted onto this site.
 * They surface as clients and can never be blocked — the controller refuses
 * with api.err.BlockUnifiDeviceForbidden — so the actions here are adopt,
 * reset, or deliberately ignore.
 */
export default async function RogueUnifiPage() {
  const session = await getAdminSession();
  const canControl = session?.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Rogue UniFi</h1>
        <p className="text-sm text-muted-foreground">
          UniFi hardware seen on the network but not adopted on this site — a factory-reset AP
          waiting to be onboarded, a switch someone plugged in, or a neighbouring network&apos;s
          router. These cannot be blocked (the controller protects its own hardware). Use{" "}
          <strong>Attempt fix</strong> to reach one over SSH with the saved credentials, the{" "}
          <strong>terminal</strong> to try a different login or reset it, or <strong>ignore</strong>{" "}
          the ones that legitimately belong to someone else.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <RogueUnifiTable canControl={canControl} />
        </CardContent>
      </Card>
    </div>
  );
}
