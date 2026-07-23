"use client";
import { useState } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

import { RUNBOOKS, type RunbookStep, type StepStatus } from "@/lib/runbookMeta";

// One icon per status with distinct shapes (check/triangle/x/i), so status
// reads without color; aria-labels carry it for screen readers.
const ICONS: Record<StepStatus, React.ReactNode> = {
  pass: <CircleCheck aria-label="Pass" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />,
  warn: <TriangleAlert aria-label="Warning" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />,
  fail: <CircleX aria-label="Fail" className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />,
  info: <Info aria-label="Info" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />,
};

export default function TroubleshootPage() {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, RunbookStep[] | null>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [running, setRunning] = useState<string | null>(null);

  const run = async (id: string) => {
    setRunning(id);
    setErrors((e) => ({ ...e, [id]: null }));
    setResults((r) => ({ ...r, [id]: null }));
    try {
      const res = await fetch("/api/admin/troubleshoot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runbook: id, input: inputs[id] ?? "" }),
      });
      const data = await res.json().catch(() => ({ error: "Bad response" }));
      if (!res.ok || data.error) {
        setErrors((e) => ({ ...e, [id]: data.error ?? `HTTP ${res.status}` }));
      } else {
        setResults((r) => ({ ...r, [id]: data.steps as RunbookStep[] }));
      }
    } catch {
      setErrors((e) => ({ ...e, [id]: "Network error" }));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Troubleshoot</h1>
        <p className="text-sm text-muted-foreground">
          Guided runbooks that check live data (controller, database, configuration) and walk through
          the fix. Running one changes nothing.
        </p>
      </div>

      {RUNBOOKS.map((rb) => {
        const steps = results[rb.id];
        const error = errors[rb.id];
        const failCount = steps?.filter((s) => s.status === "fail").length ?? 0;
        const warnCount = steps?.filter((s) => s.status === "warn").length ?? 0;
        return (
          <Card key={rb.id}>
            <CardHeader>
              <CardTitle className="text-base">{rb.title}</CardTitle>
              <CardDescription>{rb.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(rb.id);
                }}
              >
                {rb.input && (
                  <div className="flex-1 space-y-1.5">
                    <Label>{rb.input.label}</Label>
                    <Input
                      value={inputs[rb.id] ?? ""}
                      onChange={(e) => setInputs((v) => ({ ...v, [rb.id]: e.target.value }))}
                      placeholder={rb.input.placeholder}
                    />
                  </div>
                )}
                <Button
                  type="submit"
                  variant="outline"
                  disabled={running !== null || (rb.input && !(inputs[rb.id] ?? "").trim())}
                >
                  {running === rb.id ? "Running…" : "Run checks"}
                </Button>
              </form>

              {error && <p className="text-sm text-destructive">{error}</p>}

              {steps && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    {failCount === 0 && warnCount === 0
                      ? "All checks passed."
                      : `${failCount} problem${failCount !== 1 ? "s" : ""}, ${warnCount} warning${warnCount !== 1 ? "s" : ""}.`}
                  </p>
                  <ol className="space-y-2">
                    {steps.map((s, i) => (
                      <li key={i} className="rounded-md border p-3 text-sm">
                        <p className="flex items-start gap-2 font-medium">
                          {ICONS[s.status]} {s.title}
                        </p>
                        {s.detail && <p className="mt-1 text-muted-foreground">{s.detail}</p>}
                        {s.fix && (
                          <p className="mt-1 text-amber-700 dark:text-amber-300">
                            <span className="font-semibold">Fix:</span> {s.fix}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
