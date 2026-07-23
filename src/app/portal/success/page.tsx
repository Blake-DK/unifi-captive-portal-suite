import { Suspense } from "react";
import { SuccessContent } from "@/components/portal/SuccessContent";
import { getGuestBaseUrl } from "@/lib/guestHost";

export const dynamic = "force-dynamic";

export default async function PortalSuccessPage() {
  const guestBase = await getGuestBaseUrl();
  return (
    <Suspense fallback={null}>
      <SuccessContent guestBase={guestBase} />
    </Suspense>
  );
}
