# Load tests

Load tests for the guest captive flow, in two shapes.

## Simulate a real event (start here)

```sh
./test/load/simulate-event.sh                  # 3000 guests over 10 min
GUESTS=5000 WINDOW=15m ./test/load/simulate-event.sh
```

Models GUESTS people arriving over WINDOW (arrivals ramp up over the first
20% of the window, hold, then tail off). Each simulated guest loads the
captive page, spends 1-4s "filling the form", then registers. Uses the
`:nightly` registry image by default; set `E2E_IMAGE` to test a local
build. Everything runs against a throwaway local stack, so it is safe to
run any time.

## Worst-case stampede

```sh
docker build -t portal-under-test .
E2E_IMAGE=portal-under-test ./test/load/run.sh
```

A closed loop of `VUS` concurrent registrations with no think time, the
harshest shape. Tunables (env): `VUS` peak concurrent guests (default 150),
`RAMP` ramp-up time (30s), `HOLD` time at peak (60s), `THINK` per-VU pause
between registrations in seconds (0).

Thresholds for both shapes (the run fails if breached): request failure
rate < 1%, authorize p95 < 2s (override with `P95_MS`).

## Run from another machine

Copy the `test/load/` folder to any box with docker (no repo checkout, no
k6 install needed) and point it at a running portal:

```sh
TARGET=https://wifi.example.com GUESTS=50 WINDOW=2m ./remote-run.sh   # start small
TARGET=https://wifi.example.com ./remote-run.sh                       # 3000 / 10 min
```

Remote runs skip the bootstrap: the target must already be configured, and
nothing on it is changed except what real guests would change. That is the
point, and also the warning: **every iteration creates a real registration
(names `Load Guest<N>`, phones `55xxxxxxxx`) and a real authorize call for
a fake `aa:bb:*` MAC on the target's controller.** Before a big run:

- Turn OFF email verification and sponsor-required on the target, or
  registrations fail (missing email / pending approval) and, worse, each
  one tries to send mail.
- Start with `GUESTS=50 WINDOW=2m` and watch controller CPU; the portal
  holds at most 6 concurrent controller calls, so overload shows up as
  authorize latency growth, not controller meltdown.
- Cleanup: fake-MAC authorizations expire with the plan duration; the
  guest rows age out via retention, or revoke them from the admin guests
  page (search for firstName `Load`).

Extra env: `INSECURE=1` (self-signed TLS), `SITE=<slug>` (captive-page
site path, default `default`), `MODE=burst VUS=…` for the stampede shape,
`YES=1` to skip the confirmation prompt, `DOCKER_NET=<network>` to attach
the k6 container to a docker network in lab setups.

## What it does and does not cover

It runs against the e2e topology (`docker-compose.test.yml`): throwaway
Postgres, the portal image under test, and the dependency-free mock UniFi
controller. That makes it a test of the portal's own burst behavior: DB
pool queueing, the serialized audit chain, settings-cache hits, the
single-flight controller login, the bounded authorize queue.

The mock answers instantly, so controller-side latency and controller login
rate limits are NOT covered. A pass means "the app won't fall over"; sizing
a real event still needs a cautious test against a real controller (the
authorize path holds at most 6 concurrent controller calls, so watch p95
latency growth, not controller overload).
