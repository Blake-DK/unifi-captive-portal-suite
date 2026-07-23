"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAdminSettings } from "@/lib/useAdminSettings";
import { SaveToast, useSaveToast } from "@/components/admin/SaveToast";
import { PortalPreviewButton } from "@/components/admin/PortalPreviewButton";

const textareaClass =
  "min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default function BrandingSettingsPage() {
  const { settings, set, save, loading, saving } = useAdminSettings();
  const { toast, show, clear } = useSaveToast();

  const handleUpload = async (file: File, key: "logoUrl" | "backgroundUrl") => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) set(key, data.url);
      else show(data.error || "Upload failed", "error");
    } catch {
      show("Could not connect to upload server", "error");
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await save();
    show(ok ? "Settings saved!" : "Failed to save settings.", ok ? "success" : "error");
  };

  if (loading) return <div>Loading…</div>;

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Branding</CardTitle>
              <CardDescription>Portal name, images, and colours</CardDescription>
            </div>
            {/* Split deployments: this admin process serves no guest pages,
                so the preview must open on the guest-serving host. */}
            <PortalPreviewButton
              baseUrl={settings.guestPagesRemote ? settings.portalBaseUrl || settings.guestBaseUrl : ""}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Brand Name</Label>
            <Input value={settings.brandName} onChange={(e) => set("brandName", e.target.value)} placeholder="e.g. Guest WiFi Portal" />
          </div>
          <div className="space-y-1.5">
            <Label>Logo</Label>
            <div className="flex gap-2">
              <Input value={settings.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="URL or upload" />
              <div className="relative">
                <Button type="button" variant="outline" className="cursor-pointer">
                  Upload
                  <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f, "logoUrl"); }} />
                </Button>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Background Image</Label>
            <div className="flex gap-2">
              <Input value={settings.backgroundUrl} onChange={(e) => set("backgroundUrl", e.target.value)} placeholder="URL or upload" />
              <div className="relative">
                <Button type="button" variant="outline" className="cursor-pointer">
                  Upload
                  <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f, "backgroundUrl"); }} />
                </Button>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Primary Colour (Hex)</Label>
            <div className="flex gap-2">
              <Input type="color" className="w-12 p-1 h-10" value={settings.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
              <Input value={settings.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} placeholder="#171717" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Portal text</CardTitle>
          <CardDescription>Welcome message</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Welcome Text</Label>
            <Input value={settings.welcomeText} onChange={(e) => set("welcomeText", e.target.value)} placeholder="Welcome" />
          </div>
          <p className="text-xs text-muted-foreground">
            The Guest Self-Service URL and the Success Redirect URL are on Settings → URLs.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Terms of Use</CardTitle>
          <CardDescription>Shown in the access form (Markdown supported)</CardDescription>
        </CardHeader>
        <CardContent>
          <textarea className={textareaClass} style={{ minHeight: 150 }}
            value={settings.termsOfUse}
            onChange={(e) => set("termsOfUse", e.target.value)}
            placeholder="Enter your terms of use…" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy notice</CardTitle>
          <CardDescription>
            Shown to guests at <code>/portal/privacy</code> (linked from the sign-in form). Leave the
            body blank to use the built-in template grounded in the data this portal collects; the
            contact is shown so guests can exercise their data-protection rights.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Rights-request contact (email or address)</Label>
            <Input
              value={settings.privacyContact}
              onChange={(e) => set("privacyContact", e.target.value)}
              placeholder="privacy@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Custom notice body (Markdown, optional)</Label>
            <textarea className={textareaClass} style={{ minHeight: 150 }}
              value={settings.privacyNotice}
              onChange={(e) => set("privacyNotice", e.target.value)}
              placeholder="Leave blank to use the built-in template…" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warning Banner</CardTitle>
          <CardDescription>
            A full-screen click-through notice shown before the registration and guest login
            pages (WLAN STIG style: DoD-consent banners must be acknowledged each session).
            The WLAN-side inactivity timeout the STIG also asks for is a controller setting,
            not a portal one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.warningBannerEnabled}
              onChange={(e) => set("warningBannerEnabled", e.target.checked)}
            />
            Show the warning banner
          </label>
          <textarea
            value={settings.warningBannerText}
            onChange={(e) => set("warningBannerText", e.target.value)}
            rows={6}
            placeholder="You are accessing a U.S. Government (USG) Information System (IS)…"
            className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
      <SaveToast toast={toast} onClose={clear} />
    </form>
  );
}
