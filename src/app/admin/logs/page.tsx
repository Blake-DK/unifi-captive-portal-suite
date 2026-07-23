import { LogsTable } from "@/components/admin/LogsTable";

export const dynamic = "force-dynamic";

export default function LogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Connection Logs</h1>
        <p className="text-sm text-muted-foreground">
          All guests who authenticated through the portal.
        </p>
      </div>
      <LogsTable />
    </div>
  );
}
