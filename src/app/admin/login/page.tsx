import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  // The blank-username setup login only works while no admin-role account
  // exists (the login route enforces it) — only advertise it while that is
  // true. DB trouble reads as "not first time": the quieter wrong answer,
  // and setup couldn't verify a password without the DB anyway.
  const allowSetup = await prisma.adminUser
    .count({ where: { role: "admin" } })
    .then((n) => n === 0)
    .catch(() => false);

  return (
    <Suspense fallback={null}>
      <LoginForm allowSetup={allowSetup} />
    </Suspense>
  );
}
