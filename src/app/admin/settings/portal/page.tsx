import { redirect } from "next/navigation";

// Portal settings were merged into Branding — keep the old URL working.
export default function PortalSettingsRedirect() {
  redirect("/admin/settings/branding");
}
