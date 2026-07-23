import { SettingsNav } from "@/components/admin/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Portal appearance, location lists, and network configuration</p>
      </div>
      <SettingsNav />
      {children}
    </div>
  );
}
