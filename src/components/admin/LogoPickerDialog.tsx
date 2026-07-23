"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type UploadedFile = { name: string; url: string; uploadedAt: string | null };

// Stock coloured logos shipped in /public/logos — a library to pick from
// without uploading. Location-oriented ones (On Base, Dorms, Deployed…) first.
const BUILTIN_LOGOS: { label: string; url: string }[] = [
  { label: "On Base", url: "/logos/base.svg" },
  { label: "Dorms", url: "/logos/dorms.svg" },
  { label: "Deployed", url: "/logos/deployed.svg" },
  { label: "Barracks", url: "/logos/barracks.svg" },
  { label: "HQ", url: "/logos/hq.svg" },
  { label: "Building", url: "/logos/building.svg" },
  { label: "Office", url: "/logos/office.svg" },
  { label: "Home", url: "/logos/home.svg" },
  { label: "Lodging", url: "/logos/lodging.svg" },
  { label: "School", url: "/logos/school.svg" },
  { label: "Medical", url: "/logos/medical.svg" },
  { label: "Dining", url: "/logos/dining.svg" },
  { label: "Gym", url: "/logos/gym.svg" },
  { label: "Chapel", url: "/logos/chapel.svg" },
  { label: "Event", url: "/logos/event.svg" },
  { label: "Flag", url: "/logos/flag.svg" },
  { label: "Star", url: "/logos/star.svg" },
  { label: "Anchor", url: "/logos/anchor.svg" },
  { label: "Globe", url: "/logos/globe.svg" },
  { label: "Plane", url: "/logos/plane.svg" },
  { label: "WiFi", url: "/logos/wifi.svg" },
  { label: "Map pin", url: "/logos/pin.svg" },
];

/**
 * Image library: pick any previously uploaded image, or upload a new one.
 * Calls onSelect with the image URL and closes.
 */
export function LogoPickerDialog({
  onSelect,
  trigger,
}: {
  onSelect: (url: string) => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/admin/uploads")
      .then((res) => res.json())
      .then((data) => setFiles(data.files ?? []))
      .catch(() => setError("Could not load image library"))
      .finally(() => setLoading(false));
  }, [open]);

  const handleUpload = async (file: File) => {
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }
      onSelect(data.url);
      setOpen(false);
    } catch {
      setError("Could not connect to upload server");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            Choose logo…
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose a logo</DialogTitle>
          <DialogDescription>
            Pick a built-in logo, choose a previously uploaded image, or upload a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Button type="button" variant="outline" className="w-full cursor-pointer">
            Upload new image
            <input
              type="file"
              className="absolute inset-0 opacity-0 cursor-pointer"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
            />
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Built-in logos</p>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
            {BUILTIN_LOGOS.map((l) => (
              <button
                key={l.url}
                type="button"
                title={l.label}
                onClick={() => {
                  onSelect(l.url);
                  setOpen(false);
                }}
                className="flex aspect-square items-center justify-center rounded-md border p-2 transition-colors hover:border-primary hover:bg-primary/5"
              >
                <img src={l.url} alt={l.label} className="max-h-full max-w-full object-contain" />
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs font-medium text-muted-foreground">Uploaded images</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No images uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {files.map((f) => (
              <button
                key={f.name}
                type="button"
                title={f.name}
                onClick={() => {
                  onSelect(f.url);
                  setOpen(false);
                }}
                className="flex aspect-square items-center justify-center rounded-md border p-2 hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <img src={f.url} alt={f.name} className="max-h-full max-w-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
