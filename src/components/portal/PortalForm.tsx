"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { TermsModal } from "./TermsModal";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { guestRegistrationSchema, type GuestRegistrationInput } from "@/lib/validators";
import { maskPhone } from "@/lib/masks";
import type { PortalLocation } from "@/lib/locations";

type Step = "choose" | "form";

export type SponsorConfig = {
  emails: string[]; // curated sponsor dropdown
  domains: string[]; // free-text sponsor must match one of these domains
  defaultMin: number;
};

export function PortalForm({
  settings,
  locations,
  emailRequired = false,
  preview = false,
  sponsor = null,
}: {
  settings: any;
  locations: PortalLocation[];
  emailRequired?: boolean;
  preview?: boolean;
  /** Non-null = sponsored access is required (a voucher still bypasses it). */
  sponsor?: SponsorConfig | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // With zero locations the choose step is bypassed entirely; with exactly
  // one it is auto-selected. Only 2+ locations show the chooser.
  const [step, setStep] = useState<Step>(locations.length > 1 ? "choose" : "form");
  const [serverError, setServerError] = useState<string | null>(null);
  const [sponsorEmail, setSponsorEmail] = useState("");
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  // Non-null once a request is filed: the watch token the status poll uses.
  const [awaitingSponsor, setAwaitingSponsor] = useState<string | null>(null);
  const [sponsorOutcome, setSponsorOutcome] = useState<"denied" | "expired" | null>(null);

  // While a sponsor request is pending, poll its status; approval carries the
  // redirect + magic token the normal authorize response would have.
  useEffect(() => {
    if (!awaitingSponsor) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/portal/sponsor-request?watch=${encodeURIComponent(awaitingSponsor)}`,
        );
        const d = await res.json().catch(() => ({}));
        if (d.status === "approved") {
          clearInterval(t);
          const q = new URLSearchParams();
          if (d.redirect) q.set("url", d.redirect);
          if (d.magicToken) q.set("magic", d.magicToken);
          const qs = q.toString();
          router.push(`/portal/success${qs ? `?${qs}` : ""}`);
        } else if (d.status === "denied" || d.status === "expired") {
          clearInterval(t);
          setAwaitingSponsor(null);
          setSponsorOutcome(d.status);
        }
      } catch {
        // transient poll failure — keep polling
      }
    }, 5000);
    return () => clearInterval(t);
  }, [awaitingSponsor, router]);

  const unifiCtx = useMemo(
    () => ({
      // Preview has no captive MAC; a placeholder keeps the schema's
      // MAC-required rule from silently blocking the walkthrough submit
      // (the preview branch returns before anything reaches the API).
      mac: params.get("id") ?? params.get("mac") ?? (preview ? "00:00:00:00:00:00" : ""),
      apMac: params.get("ap") ?? null,
      ssid: params.get("ssid") ?? null,
      site: params.get("site") ?? null,
      originalUrl: params.get("url") ?? null,
    }),
    [params, preview],
  );

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GuestRegistrationInput>({
    resolver: zodResolver(guestRegistrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      voucher: "",
      locationId: locations.length === 1 ? locations[0].id : null,
      building: "",
      roomNumber: "",
      acceptTerms: false as unknown as true,
      ...unifiCtx,
    },
  });

  const locationId = watch("locationId");
  const phone = watch("phone");

  const selectedLocation = locations.find((l) => l.id === locationId) ?? null;
  const buildingOptions = selectedLocation?.buildings ?? [];
  // Free-text locations show a required input (configured buildings become
  // suggestions); list locations keep the dropdown.
  const buildingFreeText = selectedLocation?.buildingFreeText ?? false;
  const buildingRequired = !!selectedLocation && (buildingFreeText || buildingOptions.length > 0);

  const onSubmit = async (values: GuestRegistrationInput) => {
    setServerError(null);
    if (buildingRequired && !values.building?.trim()) {
      setError("building", {
        type: "manual",
        message: buildingFreeText ? "Please enter your building" : "Please select a building",
      });
      return;
    }
    if (selectedLocation?.isHotel && !values.roomNumber?.trim()) {
      setError("roomNumber", { type: "manual", message: "Please enter your room number" });
      return;
    }
    // A voucher stands in for email verification, so the address is optional.
    if (emailRequired && !values.email?.trim() && !values.voucher?.trim()) {
      setError("email", { type: "manual", message: "An email address is required" });
      return;
    }
    // Preview walks the whole flow: the validation above ran like the real
    // thing, but nothing is registered — straight to the success page.
    if (preview) {
      router.push("/portal/success?preview=1");
      return;
    }
    // Sponsored access: without a voucher the request goes to a sponsor for
    // approval instead of authorizing directly (a voucher IS authorization).
    if (sponsor && !values.voucher?.trim()) {
      if (!sponsorEmail.trim()) {
        setSponsorError("Choose or enter your sponsor's email address");
        return;
      }
      setSponsorError(null);
      try {
        const res = await fetch("/api/portal/sponsor-request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...values, sponsorEmail: sponsorEmail.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setServerError(data?.error ?? "Could not send the request");
          return;
        }
        setSponsorOutcome(null);
        setAwaitingSponsor(data.watch);
      } catch {
        setServerError("Network error. Please try again.");
      }
      return;
    }
    try {
      const res = await fetch("/api/portal/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(data?.error ?? "Failed to authorise access");
        return;
      }
      const target = data?.redirect || unifiCtx.originalUrl || "";
      const successParams = new URLSearchParams();
      if (target) successParams.set("url", target);
      if (data?.magicToken) successParams.set("magic", data.magicToken);
      if (data?.verifyPending) {
        successParams.set("verify", "1");
        successParams.set("min", String(data.grantedMin ?? ""));
      }
      const qs = successParams.toString();
      router.push(`/portal/success${qs ? `?${qs}` : ""}`);
    } catch {
      setServerError("Network error. Please try again.");
    }
  };

  // In preview there's no captive MAC — that's expected; render the form so an
  // admin can see exactly what a guest sees. Live (non-preview) still guards.
  if (!unifiCtx.mac && !preview) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Access Unavailable</CardTitle>
          <CardDescription>
            This page should open automatically when you connect to the guest Wi-Fi network.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
    {preview && (
      <div className="mb-3 rounded-md bg-amber-500 px-3 py-1.5 text-center text-xs font-semibold text-white shadow">
        PREVIEW — this is what a guest sees. Submitting continues the walkthrough; nothing is registered.
      </div>
    )}
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="text-center">
        {settings?.logoUrl && (
          <div className="mb-4 flex justify-center">
            <img
              key={settings.logoUrl}
              src={settings.logoUrl}
              alt={settings.brandName || "Logo"}
              className={step === "choose" ? "max-h-32 object-contain" : "max-h-16 object-contain"}
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        <CardTitle className="text-2xl">
          {step === "choose"
            ? (settings.welcomeText ?? "Welcome")
            : settings.brandName}
        </CardTitle>
        <CardDescription>
          {step === "choose"
            ? "Where are you connecting from?"
            : selectedLocation
            ? `${selectedLocation.name} — fill in your details below`
            : "Fill in your details below"}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {awaitingSponsor ? (
          <div className="space-y-3 py-4 text-center text-sm">
            <p className="font-medium">Waiting for your sponsor&apos;s approval…</p>
            <p className="text-muted-foreground">
              We emailed <span className="font-mono">{sponsorEmail}</span>. This page connects you
              automatically the moment they approve. The request expires after an hour.
            </p>
            <p aria-hidden className="animate-pulse text-2xl">···</p>
          </div>
        ) : step === "choose" ? (
          <div className="grid grid-cols-2 gap-4">
            {locations.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => {
                  setValue("locationId", loc.id);
                  setValue("building", "");
                  setValue("roomNumber", "");
                  setStep("form");
                }}
                className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-input p-6 text-sm font-semibold text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-colors"
              >
                {loc.logoUrl ? (
                  <img
                    src={loc.logoUrl}
                    alt={loc.name}
                    className="h-12 w-12 object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <MapPin aria-hidden className="h-10 w-10 text-muted-foreground" />
                )}
                {loc.name}
              </button>
            ))}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <input type="hidden" {...register("mac")} />
            <input type="hidden" {...register("apMac")} />
            <input type="hidden" {...register("ssid")} />
            <input type="hidden" {...register("site")} />
            <input type="hidden" {...register("originalUrl")} />

            <div className="grid grid-cols-2 gap-3">
              <Field label="First Name" error={errors.firstName?.message}>
                <Input placeholder="John" autoComplete="given-name" {...register("firstName")} />
              </Field>
              <Field label="Last Name" error={errors.lastName?.message}>
                <Input placeholder="Smith" autoComplete="family-name" {...register("lastName")} />
              </Field>
            </div>

            <Field label="Phone Number" error={errors.phone?.message}>
              <Input
                inputMode="tel"
                placeholder="07700 900000"
                value={maskPhone(phone || "")}
                onChange={(e) => setValue("phone", e.target.value, { shouldValidate: true })}
              />
            </Field>

            {emailRequired && (
              <Field label="Email Address" error={errors.email?.message}>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...register("email")}
                />
              </Field>
            )}

            {buildingRequired && (
              <Field label="Building" error={errors.building?.message}>
                {buildingFreeText ? (
                  <>
                    <Input
                      placeholder="e.g. Block 12"
                      maxLength={80}
                      list={buildingOptions.length > 0 ? "building-suggestions" : undefined}
                      {...register("building")}
                    />
                    {buildingOptions.length > 0 && (
                      <>
                        <datalist id="building-suggestions">
                          {buildingOptions.map((opt) => (
                            <option key={opt} value={opt} />
                          ))}
                        </datalist>
                        <p className="text-xs text-muted-foreground">
                          Suggestions appear as you type — if you don&apos;t see your building,
                          just type it in.
                        </p>
                      </>
                    )}
                  </>
                ) : (
                  <select
                    {...register("building")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">Select building…</option>
                    {buildingOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}

            {(buildingRequired || selectedLocation?.isHotel) && (
              <Field
                label={selectedLocation?.isHotel ? "Room Number" : "Room Number (optional)"}
                error={errors.roomNumber?.message}
              >
                <Input placeholder="e.g. 12B" {...register("roomNumber")} />
              </Field>
            )}

            <details className="text-sm">
              <summary className="cursor-pointer select-none text-muted-foreground">
                Have a voucher code?
              </summary>
              <div className="mt-2">
                <Field label="Voucher Code" error={errors.voucher?.message}>
                  <Input
                    placeholder="XXXX-XXXX"
                    autoComplete="off"
                    autoCapitalize="characters"
                    {...register("voucher")}
                  />
                </Field>
              </div>
            </details>

            {sponsor && (
              <Field label="Sponsor's email address" error={sponsorError ?? undefined}>
                {sponsor.emails.length > 0 ? (
                  <select
                    value={sponsorEmail}
                    onChange={(e) => setSponsorEmail(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Choose your sponsor…</option>
                    {sponsor.emails.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    type="email"
                    inputMode="email"
                    placeholder={sponsor.domains[0] ? `name@${sponsor.domains[0]}` : "sponsor email"}
                    value={sponsorEmail}
                    onChange={(e) => setSponsorEmail(e.target.value)}
                  />
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Your sponsor approves this request by email before access is granted.
                </p>
              </Field>
            )}
            {sponsorOutcome && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                {sponsorOutcome === "denied"
                  ? "Your sponsor denied the request. Check with them, or choose a different sponsor and try again."
                  : "The request expired before your sponsor responded. You can send it again."}
              </div>
            )}

            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="mt-1" {...register("acceptTerms")} />
              <span>
                I accept the <TermsModal terms={settings.termsOfUse} /> and have read the{" "}
                <a
                  href="/portal/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline transition-colors hover:text-primary"
                >
                  privacy notice
                </a>
                .
              </span>
            </label>
            {errors.acceptTerms && (
              <p className="text-xs text-destructive">{errors.acceptTerms.message as string}</p>
            )}

            {serverError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {serverError}
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              {(settings?.guestDurationMin ?? 480) > 0
                ? `Access lasts ${formatDuration(settings?.guestDurationMin ?? 480)} per device`
                : "Access doesn't expire"}
              {settings?.guestQuotaMB > 0 ? ` with a ${formatQuota(settings.guestQuotaMB)} data allowance` : ""}.
            </p>

            <div className="flex gap-2">
              {locations.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep("choose")}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
              )}
              <Button
                type="submit"
                className="flex-1 bg-primary text-primary-foreground"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
    {(step === "choose" || locations.length <= 1) && (
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Already registered?{" "}
        <a
          // Carry the captive redirect's MAC into the login page so signing
          // in also registers + authorizes this device.
          href={`${settings?.guestBaseUrl ? `${settings.guestBaseUrl}/portal/login` : "/portal/login"}${
            unifiCtx.mac ? `?id=${encodeURIComponent(unifiCtx.mac)}` : ""
          }`}
          className="underline hover:text-foreground"
        >
          Sign in{unifiCtx.mac ? " to connect this device" : " to manage your devices"}
        </a>
      </p>
    )}
    </>
  );
}

function formatDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

function formatQuota(mb: number): string {
  return mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
