import http from "node:http";

/**
 * Mock UniFi controller for the e2e suite. Dependency-free on purpose: the
 * portal only needs a controller that logs in and answers its polls, so the
 * whole surface fits in one file. Every request is recorded and served back
 * on GET /__requests so specs can assert what the portal actually sent
 * (the guest authorize in particular).
 *
 * The one hard rule: NEVER answer the login endpoints with 401 — three
 * failed logins trip a 10-minute in-memory account cooldown in the portal's
 * UniFi client and the suite goes dark for no visible reason. Answering 200
 * on /api/login also settles the portal's auto-detect on the classic API,
 * so no path below carries the /proxy/network prefix.
 */

const PORT = 9080;
const requests = [];

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const routes = [
  // Logins: 200, no Set-Cookie needed (the client tolerates its absence).
  { m: "POST", re: /^\/api\/login$/, body: {} },
  { m: "POST", re: /^\/api\/auth\/login$/, body: {} },
  // Read polls: empty controller.
  { m: "GET", re: /^\/api\/s\/[^/]+\/stat\/(device|health|sta|rogueap|alarm)/, body: { data: [] } },
  { m: "GET", re: /^\/api\/s\/[^/]+\/rest\/(networkconf|wlanconf)/, body: { data: [] } },
  // Event log query is a POST in the classic API.
  { m: "POST", re: /^\/api\/s\/[^/]+\/stat\/event$/, body: { data: [] } },
  // The guest authorize — recording this call is the suite's whole point.
  { m: "POST", re: /^\/api\/s\/[^/]+\/cmd\/stamgr$/, body: {} },
  // Best-effort client-note write after an authorize.
  { m: "PUT", re: /^\/api\/s\/[^/]+\/rest\/user\/[^/]+$/, body: {} },
];

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "mock"}`);
    const path = url.pathname;

    if (req.method === "GET" && path === "/__health") return json(res, 200, { ok: true });
    if (req.method === "GET" && path === "/__requests") return json(res, 200, requests);

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = raw;
      if ((req.headers["content-type"] ?? "").includes("application/json") && raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          /* keep the raw string */
        }
      }
      requests.push({ method: req.method, path, query: url.search, body, ts: Date.now() });

      const hit = routes.find((r) => r.m === req.method && r.re.test(path));
      if (hit) return json(res, 200, hit.body);
      // Unknown controller path: answer like an empty classic endpoint so
      // small surface drift doesn't fail the suite, but say so in the log —
      // the failure dump makes drift visible instead of silent.
      console.log(`[mock-unifi] unmatched: ${req.method} ${path}`);
      return json(res, 200, { data: [] });
    });
  })
  .listen(PORT, () => console.log(`[mock-unifi] listening on :${PORT}`));
