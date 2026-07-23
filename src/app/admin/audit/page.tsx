import { AuditTable } from "@/components/admin/AuditTable";
import { VerifyChainButton } from "@/components/admin/VerifyChainButton";

export const dynamic = "force-dynamic";

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Trail</h1>
        <p className="text-sm text-muted-foreground">
          Who did what, when — admin actions, guest self-service changes, logins,
          permission denials, and traffic-data lookups. Entries are hash-chained:
          each row seals the one before it, and Verify chain proves none were
          silently altered or removed.
        </p>
      </div>
      <VerifyChainButton />
      <AuditTable />
    </div>
  );
}
