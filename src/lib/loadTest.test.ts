import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSummaries,
  buildLaunchScript,
  buildStatusScript,
  buildStopScript,
  containerName,
  isFakeLoadMac,
  parseK6Summary,
  parseStatusOutput,
  parseWindowSeconds,
  sq,
  type RunParams,
} from "./loadTestCore.ts"; // explicit extension for Node's type-stripping runner

const PARAMS: RunParams = {
  target: "https://wifi.example.uk",
  mode: "event",
  guests: 3000,
  window: "10m",
  vus: 150,
  ramp: "30s",
  hold: "60s",
  think: 0,
  site: "default",
  insecure: true,
  p95Ms: 2000,
};

describe("isFakeLoadMac", () => {
  it("matches the harness prefix, any case", () => {
    assert.equal(isFakeLoadMac("aa:bb:00:00:00:01"), true);
    assert.equal(isFakeLoadMac("AA:BB:0F:42:40:00"), true);
  });
  it("rejects real MACs and junk", () => {
    assert.equal(isFakeLoadMac("3c:78:95:01:76:94"), false);
    assert.equal(isFakeLoadMac(""), false);
    assert.equal(isFakeLoadMac(undefined as unknown as string), false);
  });
});

describe("sq", () => {
  it("single-quotes and escapes embedded quotes", () => {
    assert.equal(sq("plain"), "'plain'");
    assert.equal(sq("a'b"), "'a'\\''b'");
  });
});

describe("parseWindowSeconds", () => {
  it("reads durations", () => {
    assert.equal(parseWindowSeconds("10m"), 600);
    assert.equal(parseWindowSeconds("90s"), 90);
    assert.equal(parseWindowSeconds("1h"), 3600);
    assert.equal(parseWindowSeconds("45"), 45);
    assert.equal(parseWindowSeconds("nonsense"), 0);
  });
});

describe("buildLaunchScript", () => {
  it("emits a detached docker run with the env and base64 script, no sudo", () => {
    const s = buildLaunchScript(7, 1, PARAMS);
    assert.match(s, /docker run -d --name 'portal-loadtest-7-s1'/);
    assert.match(s, /-e TARGET='https:\/\/wifi\.example\.uk'/);
    assert.match(s, /-e SHARD='1'/);
    assert.match(s, /-e SUMMARY_PATH='\/out\/summary-7-s1\.json'/);
    assert.match(s, /base64 -d > "\$D\/script-7-s1\.js"/);
    assert.match(s, /run \/out\/script-7-s1\.js/);
    assert.doesNotMatch(s, /sudo/);
  });
});

describe("buildStatusScript / buildStopScript", () => {
  it("inspects the shard container and brackets the summary", () => {
    const s = buildStatusScript(3, 2);
    assert.match(s, /inspect -f '\{\{\.State\.Status\}\}:\{\{\.State\.ExitCode\}\}' 'portal-loadtest-3-s2'/);
    assert.match(s, /SUMMARY_BEGIN/);
    assert.match(s, /summary-3-s2\.json/);
  });
  it("stop force-removes the container", () => {
    assert.match(buildStopScript(3, 2), /docker rm -f 'portal-loadtest-3-s2'/);
  });
});

describe("containerName", () => {
  it("is stable per run+shard", () => {
    assert.equal(containerName(12, 3), "portal-loadtest-12-s3");
  });
});

const SAMPLE = {
  metrics: {
    iterations: { values: { count: 100, rate: 5 } },
    http_reqs: { values: { count: 200, rate: 10 } },
    http_req_duration: { values: { "p(95)": 50 } },
    "http_req_duration{endpoint:authorize}": { values: { "p(95)": 30 } },
    http_req_failed: { values: { rate: 0 } },
    checks: { values: { rate: 1 } },
  },
};

describe("parseK6Summary", () => {
  it("pulls the headline metrics", () => {
    const s = parseK6Summary(SAMPLE)!;
    assert.equal(s.iterations, 100);
    assert.equal(s.reqs, 200);
    assert.equal(s.reqsPerSec, 10);
    assert.equal(s.authorizeP95Ms, 30);
    assert.equal(s.overallP95Ms, 50);
    assert.equal(s.failedRate, 0);
    assert.equal(s.checksRate, 1);
  });
  it("returns null on empty/garbage", () => {
    assert.equal(parseK6Summary(null), null);
    assert.equal(parseK6Summary({} as never), null);
  });
});

describe("aggregateSummaries", () => {
  it("sums throughput and takes the worst p95 / fail rate", () => {
    const a = parseK6Summary(SAMPLE)!;
    const b = parseK6Summary({
      metrics: {
        iterations: { values: { count: 50, rate: 3 } },
        http_reqs: { values: { count: 90, rate: 6 } },
        http_req_duration: { values: { "p(95)": 80 } },
        "http_req_duration{endpoint:authorize}": { values: { "p(95)": 70 } },
        http_req_failed: { values: { rate: 0.02 } },
        checks: { values: { rate: 0.98 } },
      },
    })!;
    const agg = aggregateSummaries([a, b])!;
    assert.equal(agg.iterations, 150);
    assert.equal(agg.reqs, 290);
    assert.equal(agg.reqsPerSec, 16);
    assert.equal(agg.authorizeP95Ms, 70); // worst
    assert.equal(agg.failedRate, 0.02); // worst
    assert.equal(agg.checksRate, 0.98); // worst
  });
  it("is null when nothing finished", () => {
    assert.equal(aggregateSummaries([null, null]), null);
  });
});

describe("parseStatusOutput", () => {
  it("maps container state to run state", () => {
    assert.equal(parseStatusOutput("STATE=running:0\nSUMMARY_BEGIN\nSUMMARY_END").state, "running");
    assert.equal(parseStatusOutput("STATE=exited:0\nSUMMARY_BEGIN\nSUMMARY_END").state, "done");
    assert.equal(parseStatusOutput("STATE=exited:99\nSUMMARY_BEGIN\nSUMMARY_END").state, "error");
    assert.equal(parseStatusOutput("STATE=gone:\nSUMMARY_BEGIN\nSUMMARY_END").state, "gone");
  });
  it("parses an embedded summary block", () => {
    const out = `STATE=exited:0\nSUMMARY_BEGIN\n${JSON.stringify(SAMPLE)}\nSUMMARY_END\n`;
    const r = parseStatusOutput(out);
    assert.equal(r.state, "done");
    assert.equal(r.summary?.reqs, 200);
  });
});
