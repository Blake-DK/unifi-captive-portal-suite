import { CreateUserForm } from "@/components/admin/CreateUserForm";
import { listLocationsForPortal } from "@/lib/locations";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const locations = await listLocationsForPortal();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New User</h1>
        <p className="text-sm text-muted-foreground">
          Create a guest record and authorize their first device on the network.
        </p>
      </div>
      <CreateUserForm locations={locations} />
    </div>
  );
}
