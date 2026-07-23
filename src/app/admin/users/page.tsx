import { UsersTable } from "@/components/admin/UsersTable";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Everyone who has registered a device through the portal, grouped by phone number.
        </p>
      </div>
      <UsersTable />
    </div>
  );
}
