import { LocationsEditor } from "@/components/admin/LocationsEditor";
import { RetentionSettings } from "@/components/admin/RetentionSettings";

export const dynamic = "force-dynamic";

export default function LocationsSettingsPage() {
  return (
    <div className="grid gap-6">
      <LocationsEditor />
      <RetentionSettings />
    </div>
  );
}
