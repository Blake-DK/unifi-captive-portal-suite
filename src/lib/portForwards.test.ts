import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildExposureGroups,
  exposureKey,
  type BuildExposureInput,
  type EnrichStation,
} from "./portForwardsCore.ts"; // explicit extension for Node's type-stripping runner

const empty: BuildExposureInput = {
  forwards: [],
  upnpMappings: [],
  stationByIp: new Map<string, EnrichStation>(),
  deviceName: new Map<string, string>(),
  networkNameById: new Map<string, string>(),
  networks: [],
  noteByKey: new Map<string, string>(),
};

describe("exposureKey", () => {
  it("is stable and independent of the controller _id", () => {
    assert.equal(exposureKey("port-forward", "TCP", "443", "10.0.0.5", "443"), "port-forward:tcp:443->10.0.0.5:443");
  });
  it("distinguishes a static forward from a UPnP lease on the same ports", () => {
    assert.notEqual(
      exposureKey("port-forward", "tcp", "80", "10.0.0.9", "80"),
      exposureKey("upnp", "tcp", "80", "10.0.0.9", "80"),
    );
  });
});

describe("buildExposureGroups", () => {
  it("returns nothing for no forwards or leases", () => {
    assert.deepEqual(buildExposureGroups(empty), { groups: [], total: 0 });
  });

  it("enriches a static forward with the target station's name, MAC and network", () => {
    const station: EnrichStation = { mac: "aa:bb:cc:dd:ee:ff", name: "NAS", network_id: "net1" };
    const { groups, total } = buildExposureGroups({
      ...empty,
      forwards: [{ _id: "x1", name: "NAS HTTPS", enabled: true, proto: "tcp", dst_port: "443", fwd: "10.0.0.5", fwd_port: "443", src: "any" }],
      stationByIp: new Map([["10.0.0.5", station]]),
      networkNameById: new Map([["net1", "Servers"]]),
    });
    assert.equal(total, 1);
    assert.equal(groups.length, 1);
    const g = groups[0];
    assert.equal(g.deviceLabel, "NAS");
    assert.equal(g.deviceMac, "aa:bb:cc:dd:ee:ff");
    assert.equal(g.network, "Servers");
    assert.equal(g.rows[0].source, "port-forward");
    assert.equal(g.rows[0].src, "any");
  });

  it("groups a static forward and a UPnP lease on the same device together", () => {
    const { groups, total } = buildExposureGroups({
      ...empty,
      forwards: [{ proto: "tcp", dst_port: "8123", fwd: "10.0.0.9", fwd_port: "8123" }],
      upnpMappings: [{ proto: "udp", ext_port: 51820, int_ip: "10.0.0.9", int_port: 51820, description: "wireguard" }],
    });
    assert.equal(total, 2);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].rows.length, 2);
    assert.ok(groups[0].rows.some((r) => r.source === "upnp"));
  });

  it("falls back to the target IP as label when the device is offline, resolving the VLAN by subnet", () => {
    const { groups } = buildExposureGroups({
      ...empty,
      forwards: [{ proto: "tcp", dst_port: "22", fwd: "10.0.20.50", fwd_port: "22" }],
      networks: [{ name: "IoT", ip_subnet: "10.0.20.1/24" }],
    });
    assert.equal(groups[0].deviceLabel, "10.0.20.50");
    assert.equal(groups[0].deviceMac, null);
    assert.equal(groups[0].network, "IoT");
  });

  it("attaches an operator note by stable key", () => {
    const key = exposureKey("port-forward", "tcp", "25565", "10.0.0.7", "25565");
    const { groups } = buildExposureGroups({
      ...empty,
      forwards: [{ proto: "tcp", dst_port: "25565", fwd: "10.0.0.7", fwd_port: "25565" }],
      noteByKey: new Map([[key, "Minecraft server — temporary"]]),
    });
    assert.equal(groups[0].rows[0].note, "Minecraft server — temporary");
  });

  it("sorts groups by device label", () => {
    const { groups } = buildExposureGroups({
      ...empty,
      forwards: [
        { proto: "tcp", dst_port: "1", fwd: "10.0.0.2", fwd_port: "1" },
        { proto: "tcp", dst_port: "2", fwd: "10.0.0.3", fwd_port: "2" },
      ],
      stationByIp: new Map<string, EnrichStation>([
        ["10.0.0.2", { mac: "m1", name: "Zebra" }],
        ["10.0.0.3", { mac: "m2", name: "Apple" }],
      ]),
    });
    assert.deepEqual(groups.map((g) => g.deviceLabel), ["Apple", "Zebra"]);
  });
});
