"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

export type ToastState = { message: string; kind: "success" | "error" } | null;

/** In-app save feedback: replaces window.alert() on the settings pages. */
export function useSaveToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const show = useCallback(
    (message: string, kind: "success" | "error" = "success") => setToast({ message, kind }),
    [],
  );
  const clear = useCallback(() => setToast(null), []);
  return { toast, show, clear };
}

export function SaveToast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-md border bg-card p-3 text-sm shadow-lg ${
        toast.kind === "success" ? "border-green-600/50" : "border-red-600/50"
      }`}
    >
      {toast.kind === "success" ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      )}
      <span>{toast.message}</span>
    </div>
  );
}
