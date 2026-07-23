# Load testing

How the guest captive flow behaves under a crowd, how to reproduce it, and
what the runs so far actually showed.

> Mirror note: this page is also published to the project wiki at the next
> promotion. Edit it here.

## Why

The guest sign-on path (`POST /api/portal/authorize` → register → authorize
the MAC on the UniFi controller) has to survive an event where a few
thousand people connect in a short window. The concern was never steady
traffic; it was a synchronized burst. Before this work there was no way to
measure it. The harness under `test/load/` fills that gap, and the burst
hardening in `src/lib/` (single-flight controller login, a bounded authorize
queue, an off-request-path audit writer, a settings-row cache, a larger DB
pool) is what it exercises.

## The harness

Everything lives in `test/load/`. It runs k6 in a container, so a load
generator needs only docker: no repo checkout, no k6 install, no node.

| Entry point | Shape | Target |
|---|---|---|
| `simulate-event.sh` | GUESTS guests arriving over WINDOW (page load + 1-4s form fill + register), arrival-rate ramp/hold/tail | Local throwaway stack (mock controller) |
| `run.sh` | Closed-loop stampede, VUS concurrent with no think time | Local throwaway stack |
| `remote-run.sh` | Either shape, `TARGET=<url>` | Any reachable portal, driven from any machine |

`registration-burst.js` is the k6 script both use. Key env: `MODE`
(`event`/`burst`), `GUESTS`, `WINDOW`, `VUS`, `THINK`, `TARGET`, `SITE`,
`INSECURE`, `P95_MS`, `SHARD`, `YES`. Thresholds: request failure rate < 1%,
authorize p95 < 2s (override with `P95_MS`).

### Local (safe any time)

```sh
./test/load/simulate-event.sh                 # 3000 guests over 10 min, :nightly image
GUESTS=5000 WINDOW=15m ./test/load/simulate-event.sh
E2E_IMAGE=portal-under-test ./test/load/run.sh   # stampede shape, local build
```

The local modes stand up a throwaway Postgres + the portal image + a
dependency-free mock controller. They measure the portal's own burst
behavior (pool queueing, audit serialization, single-flight login); the mock
answers instantly, so controller latency is not represented.

### Remote (real target)

```sh
# from any box with docker that can reach the portal
TARGET=https://wifi.example.com GUESTS=50 WINDOW=2m ./test/load/remote-run.sh
```

Remote runs skip the admin bootstrap: the target must already be
configured, and **every iteration is a real registration** (guest name
`Load Guest<N>`, phone `55xxxxxxxx`) and a **real authorize call for a fake
`aa:bb:*` MAC on the target's controller**. Before a real run:

- Turn **off** email verification and sponsor-required on the target, or
  registrations fail (missing email / pending approval) and each attempt
  tries to send mail.
- Start small (`GUESTS=50`) and watch controller CPU. The authorize path
  holds at most 6 concurrent controller calls, so overload shows up as
  authorize-latency growth, not controller meltdown.
- Clean up afterwards: revoke the `Load` guests from the admin guests page
  (this unauthorizes the fake MACs on the controller too), and turn email
  verification back on.

### Multiple load generators

To drive real distributed load, run `remote-run.sh` on several boxes at once
and give each a distinct `SHARD` (0, 1, 2, …). Each k6 instance numbers its
iterations from zero, so without sharding two boxes would mint identical
phones and MACs and collide on the target (device cap, MAC ownership
transfer). `SHARD=n` offsets a box into its own million-wide identity band.

```sh
# box A, on the portal's LAN
TARGET=http://192.168.1.15 GUESTS=250 WINDOW=4m SHARD=0 ./test/load/remote-run.sh
# box B
TARGET=http://192.168.1.15 GUESTS=250 WINDOW=4m SHARD=1 ./test/load/remote-run.sh
```

## Results so far

Two environments: the dev host against the mock controller (app-side
ceiling), and the RAF example nightly host against its live controller
(real end-to-end latency).

| Run | Where | Guests | Peak rate | Failures | Authorize p95 |
|---|---|---:|---:|---:|---:|
| Stampede | dev host, mock | 22,739 in 100s | ~227/s | 0 / 22,744 | 990ms |
| Single box | example, live | ~90 | ~1/s | 0 / 360 | ~25ms |
| Single box | example, live | ~89 | ~1/s | 0 / 356 | ~22ms |
| Two boxes (combined) | example, live | 503 | ~2.8/s | 0 / 2,012 | ~21ms |

The two-box run was `portal` (host itself, shard 0) and `portal-02`
(192.168.1.3, shard 1), both registering distinct guests against the portal
at 192.168.1.15 over the LAN, simultaneously.

## Findings

- **No defects, no code change warranted by the evidence.** Every run
  finished with zero request failures and every check green. Authorize
  latency to the real controller held at 12-21ms p95 across the single- and
  two-box runs; the app-side stampede sustained 227 registrations/s.
- The only latency excursion (~145ms max, early in each example run) lines
  up with the cold single-flight login: the first request performs the
  controller login while the rest wait on the shared promise, then the cache
  is warm. That is the intended behavior, and it replaces the pre-fix failure
  mode where a burst fired one login per request and tripped the account
  lockout.
- **What has NOT been proven.** The highest rate driven at the *real*
  controller is ~2.8/s, well below a true 3000-in-ten-minutes burst
  (~6.7/s peak). The 227/s figure is app-side only (mock controller). So the
  real controller path is confirmed healthy and low-latency, not confirmed at
  burst scale.

## In-app runner (sidebar → System → Load test)

The same harness can be driven from the admin UI instead of copying
`test/load/` to a box by hand. Open **Load test** (sidebar, under System):

1. **Add a generator box** (its IP/hostname, SSH username, port). The portal
   mints a dedicated ed25519 keypair for that box and shows two copy-paste
   one-liners: one that installs the public key into the box's
   `~/.ssh/authorized_keys`, and one (`usermod -aG docker <user>`) that lets
   the SSH user run Docker without sudo. Run both on the box, then hit **Test**
   (confirms SSH auth + that Docker is runnable). The private key is encrypted
   at rest (AES-256-GCM) and never leaves the server. The portal never holds a
   sudo password for a box — Docker access is via docker-group membership.
2. **Run a test.** Tick the boxes to use, set the target portal URL (must be
   reachable *from the generator boxes*), the mode/guests/window, and press
   Run. The portal SSHes in and launches the k6 image as a detached container
   per box (one shard each, so identities never collide), then polls each box
   for live per-shard state and the aggregated result (registrations,
   throughput, authorize p95, failure rate).
3. **Clean up.** The **Clean up the controller** button revokes every fake
   `aa:bb:*` MAC still authorized on the controller — through the portal's own
   UniFi session, no extra credentials — and deletes the matching `Load` guest
   rows. Safe to run before and after a test; idempotent.

Everything here is admin + settings-role gated and audited
(`loadtest.host.*`, `loadtest.run.*`, `loadtest.cleanup`). Registrations and
MAC authorizations against the target are REAL, exactly as with the CLI
harness, so turn email verification / sponsor mode off on the target first.

## Before a real 3k-guest event

1. Run a higher-rate real-controller test (raise `GUESTS`/shorten `WINDOW`,
   or add load boxes) to find where the 6-slot authorize queue starts adding
   latency. That ceiling is controller hardware dependent and the mock
   cannot show it. The in-app runner above is the quickest way to fan out
   across several boxes.
2. Confirm email verification / sponsor mode are set the way the event needs
   them; both change the registration cost per guest.
3. Watch controller CPU during the test, not just portal metrics.
