"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

/** A paste-and-run one-liner that installs the portal's public key on a box:
 * ensures ~/.ssh with correct perms, then appends the key only if it is not
 * already present (idempotent). The key has no quotes, so single-quoting is safe. */
const installCmd = (key: string) =>
  `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && { grep -qxF '${key}' ~/.ssh/authorized_keys || printf '%s\\n' '${key}' >> ~/.ssh/authorized_keys; }`;

/** Optional: put the SSH user in the docker group so Docker runs without sudo
 * (takes effect on the next login). Then the sudo password field can stay blank. */
const dockerGroupCmd = (username: string) => `sudo usermod -aG docker ${username} && echo 'done — reconnect for it to take effect'`;

type Host = {
  id: number;
  label: string;
  host: string;
  port: number;
  username: string;
  publicKey: string;
};

type RunSummary = {
  iterations: number;
  reqs: number;
  reqsPerSec: number;
  authorizeP95Ms: number | null;
  overallP95Ms: number | null;
  failedRate: number;
  checksRate: number;
};

type Run = {
  id: number;
  createdAt: string;
  status: string;
  mode: string;
  guests: number;
  windowSec: number;
  target: string;
  finishedAt: string | null;
  summary: RunSummary | null;
};

type Shard = { shard: number; hostId: number; state: string; exitCode: number | null; summary: RunSummary | null };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export default function LoadTestPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Add-host form
  const [addForm, setAddForm] = useState({ label: "", host: "", port: "22", username: "" });
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; message: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // Params
  const [params, setParams] = useState({
    target: "",
    mode: "event",
    guests: "3000",
    window: "10m",
    vus: "150",
    ramp: "30s",
    hold: "60s",
    site: "default",
    insecure: true,
    p95Ms: "2000",
  });

  // Run
  const [run, setRun] = useState<Run | null>(null);
  const [shards, setShards] = useState<Shard[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHosts = useCallback(async () => {
    const b = await api("/api/admin/loadtest/hosts");
    setHosts(b.hosts);
  }, []);

  const pollStatus = useCallback(async (runId: number) => {
    try {
      const b = await api(`/api/admin/loadtest/status?runId=${runId}`);
      setRun(b.run);
      if (b.shards) setShards(b.shards);
      if (b.finished && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch {
      /* transient; keep polling */
    }
  }, []);

  const startPolling = useCallback(
    (runId: number) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollStatus(runId);
      pollRef.current = setInterval(() => pollStatus(runId), 4000);
    },
    [pollStatus],
  );

  useEffect(() => {
    (async () => {
      try {
        await loadHosts();
        const b = await api("/api/admin/loadtest/runs");
        const latest: Run | undefined = b.runs?.[0];
        if (latest) {
          setRun(latest);
          if (latest.status === "running") startPolling(latest.id);
        }
      } catch (e) {
        setBanner({ kind: "err", text: e instanceof Error ? e.message : "Failed to load" });
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadHosts, startPolling]);

  const addHost = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setBanner(null);
    try {
      await api("/api/admin/loadtest/hosts", {
        method: "POST",
        body: JSON.stringify({ ...addForm, port: Number(addForm.port) || 22 }),
      });
      setAddForm({ label: "", host: "", port: "22", username: "" });
      await loadHosts();
      setBanner({ kind: "ok", text: "Host added. Copy the install command below and run it on that box to authorize the portal, then hit Test." });
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Add failed" });
    } finally {
      setAdding(false);
    }
  };

  const removeHost = async (id: number) => {
    try {
      await api(`/api/admin/loadtest/hosts/${id}`, { method: "DELETE" });
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      await loadHosts();
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Delete failed" });
    }
  };

  const testHost = async (id: number) => {
    setTesting(id);
    try {
      const r = await api(`/api/admin/loadtest/hosts/${id}/test`, { method: "POST" });
      setTestResult((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setTestResult((m) => ({ ...m, [id]: { ok: false, message: e instanceof Error ? e.message : "Test failed" } }));
    } finally {
      setTesting(null);
    }
  };

  const copy = async (marker: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(marker);
      setTimeout(() => setCopied((c) => (c === marker ? null : c)), 1500);
    } catch {
      /* clipboard blocked; the value is selectable in the field */
    }
  };

  const startRun = async () => {
    setStarting(true);
    setBanner(null);
    try {
      const b = await api("/api/admin/loadtest/run", {
        method: "POST",
        body: JSON.stringify({
          hostIds: [...selected],
          target: params.target,
          mode: params.mode,
          guests: Number(params.guests),
          window: params.window,
          vus: Number(params.vus),
          ramp: params.ramp,
          hold: params.hold,
          site: params.site,
          insecure: params.insecure,
          p95Ms: Number(params.p95Ms),
        }),
      });
      const failed = (b.launched ?? []).filter((l: { error?: string }) => l.error);
      if (failed.length) setBanner({ kind: "err", text: `${failed.length} box(es) failed to launch: ${failed.map((f: { error?: string }) => f.error).join("; ")}` });
      else setBanner({ kind: "ok", text: `Run #${b.runId} launched on ${b.launched.length} box(es).` });
      startPolling(b.runId);
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Run failed to start" });
    } finally {
      setStarting(false);
    }
  };

  const stopRun = async () => {
    if (!run) return;
    try {
      await api("/api/admin/loadtest/stop", { method: "POST", body: JSON.stringify({ runId: run.id }) });
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      await pollStatus(run.id);
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Stop failed" });
    }
  };

  const cleanup = async () => {
    setCleaning(true);
    setBanner(null);
    try {
      const r = await api("/api/admin/loadtest/cleanup", { method: "POST" });
      setBanner({
        kind: "ok",
        text: `Cleanup done: ${r.revoked}/${r.authorizedFound} fake MACs revoked on the controller${r.failed ? ` (${r.failed} failed)` : ""}, ${r.dbRowsDeleted} guest rows deleted.`,
      });
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Cleanup failed" });
    } finally {
      setCleaning(false);
    }
  };

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const running = run?.status === "running";
  const elapsed = run ? Math.max(0, (Date.now() - new Date(run.createdAt).getTime()) / 1000) : 0;
  const pct = run && run.windowSec > 0 ? Math.min(100, Math.round((elapsed / run.windowSec) * 100)) : running ? 50 : 100;

  if (loading) return <div>Loading…</div>;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Load test</h1>
        <p className="text-sm text-muted-foreground">
          Drive the guest-registration load harness from remote boxes, watch it live, and clean up the controller after.
        </p>
      </div>
      {banner && (
        <div className={`rounded-md border px-4 py-2 text-sm ${banner.kind === "ok" ? "border-green-500/40 bg-green-500/10" : "border-red-500/40 bg-red-500/10"}`}>
          {banner.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Generator boxes</CardTitle>
          <CardDescription>
            Machines that run the k6 registration-burst harness against a target portal. The portal generates a dedicated
            SSH key per box; copy the one-line command it shows and run it on that box to authorize the portal for
            passwordless launches. The SSH user must be able to run Docker without sudo — the second command puts them
            in the docker group.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {hosts.length === 0 && <p className="text-sm text-muted-foreground">No generator boxes yet.</p>}
          {hosts.map((h) => (
            <div key={h.id} className="rounded-md border p-3 grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggle(h.id)} aria-label={`Select ${h.host}`} />
                <span className="font-medium">{h.label || h.host}</span>
                <span className="text-sm text-muted-foreground">
                  {h.username}@{h.host}:{h.port}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => testHost(h.id)} disabled={testing === h.id}>
                    {testing === h.id ? "Testing…" : "Test"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => removeHost(h.id)}>
                    Remove
                  </Button>
                </div>
              </div>
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">
                  Run this once on {h.host} (as {h.username}) to authorize the portal:
                </p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={installCmd(h.publicKey)} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(`${h.id}-cmd`, installCmd(h.publicKey))}>
                    {copied === `${h.id}-cmd` ? "Copied" : "Copy command"}
                  </Button>
                </div>
                <button
                  type="button"
                  className="justify-self-start text-xs text-muted-foreground underline"
                  onClick={() => copy(`${h.id}-key`, h.publicKey)}
                >
                  {copied === `${h.id}-key` ? "Key copied" : "copy the key only"}
                </button>
              </div>
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">
                  Then let {h.username} run Docker without sudo (run once, reconnect after):
                </p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={dockerGroupCmd(h.username)} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(`${h.id}-docker`, dockerGroupCmd(h.username))}>
                    {copied === `${h.id}-docker` ? "Copied" : "Copy command"}
                  </Button>
                </div>
              </div>
              {testResult[h.id] && (
                <p className={`text-xs ${testResult[h.id].ok ? "text-green-600" : "text-red-600"}`}>{testResult[h.id].message}</p>
              )}
            </div>
          ))}

          <form onSubmit={addHost} className="grid gap-3 rounded-md border border-dashed p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Label</Label>
                <Input value={addForm.label} onChange={(e) => setAddForm({ ...addForm, label: e.target.value })} placeholder="portal-02" />
              </div>
              <div className="space-y-1.5">
                <Label>Host / IP *</Label>
                <Input value={addForm.host} onChange={(e) => setAddForm({ ...addForm, host: e.target.value })} placeholder="192.168.0.10" required />
              </div>
              <div className="space-y-1.5">
                <Label>SSH username *</Label>
                <Input value={addForm.username} onChange={(e) => setAddForm({ ...addForm, username: e.target.value })} placeholder="deploy" required />
              </div>
              <div className="space-y-1.5">
                <Label>SSH port</Label>
                <Input type="number" min={1} max={65535} value={addForm.port} onChange={(e) => setAddForm({ ...addForm, port: e.target.value })} />
              </div>
            </div>
            <div>
              <Button type="submit" disabled={adding}>
                {adding ? "Generating key…" : "Add box"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run a test</CardTitle>
          <CardDescription>
            Fans out across the selected boxes, one shard each (identities never collide). A real 3,000-guest / 10-minute
            event peaks near 6.7 registrations/second. Every registration and MAC authorization is REAL on the target.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Target portal URL *</Label>
            <Input
              value={params.target}
              onChange={(e) => setParams({ ...params, target: e.target.value })}
              placeholder="https://wifi.example.uk (must be reachable from the generator boxes)"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <select className={selectClass} value={params.mode} onChange={(e) => setParams({ ...params, mode: e.target.value })}>
                <option value="event">Event (arrivals over a window)</option>
                <option value="burst">Burst (closed-loop VUs)</option>
              </select>
            </div>
            {params.mode === "event" ? (
              <>
                <div className="space-y-1.5">
                  <Label>Guests</Label>
                  <Input type="number" min={1} value={params.guests} onChange={(e) => setParams({ ...params, guests: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Window</Label>
                  <Input value={params.window} onChange={(e) => setParams({ ...params, window: e.target.value })} placeholder="10m" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Peak VUs</Label>
                  <Input type="number" min={1} value={params.vus} onChange={(e) => setParams({ ...params, vus: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Hold</Label>
                  <Input value={params.hold} onChange={(e) => setParams({ ...params, hold: e.target.value })} placeholder="60s" />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Captive site slug</Label>
              <Input value={params.site} onChange={(e) => setParams({ ...params, site: e.target.value })} placeholder="default" />
            </div>
            <div className="space-y-1.5">
              <Label>Authorize p95 threshold (ms)</Label>
              <Input type="number" min={1} value={params.p95Ms} onChange={(e) => setParams({ ...params, p95Ms: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={params.insecure} onChange={(e) => setParams({ ...params, insecure: e.target.checked })} />
              Skip TLS verify (self-signed target)
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={startRun} disabled={starting || running || selected.size === 0 || !params.target}>
              {starting ? "Launching…" : running ? "Running…" : `Run on ${selected.size} box(es)`}
            </Button>
            {running && (
              <Button type="button" variant="outline" onClick={stopRun}>
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {run && (
        <Card>
          <CardHeader>
            <CardTitle>
              Run #{run.id} — {run.status}
            </CardTitle>
            <CardDescription>
              {run.mode} · {run.guests} guests · target {run.target}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {running && (
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
            {shards && (
              <div className="grid gap-1 text-sm">
                {shards.map((s) => (
                  <div key={s.shard} className="flex gap-2">
                    <span className="text-muted-foreground">shard {s.shard}</span>
                    <span>{s.state}</span>
                    {s.summary && <span className="text-muted-foreground">{s.summary.reqs} reqs</span>}
                  </div>
                ))}
              </div>
            )}
            {run.summary && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Registrations" value={run.summary.iterations.toLocaleString()} />
                <Stat label="Throughput" value={`${run.summary.reqsPerSec.toFixed(1)}/s`} />
                <Stat label="Authorize p95" value={run.summary.authorizeP95Ms != null ? `${Math.round(run.summary.authorizeP95Ms)} ms` : "—"} />
                <Stat label="Failed" value={`${(run.summary.failedRate * 100).toFixed(2)}%`} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Clean up the controller</CardTitle>
          <CardDescription>
            Revokes every fake load-test MAC (aa:bb:…) still authorized on the UniFi controller and deletes the matching
            guest rows. Uses the portal&apos;s own controller session — no extra credentials. Safe to run before and after a test.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={cleanup} disabled={cleaning}>
            {cleaning ? "Cleaning…" : "Clean up now"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
