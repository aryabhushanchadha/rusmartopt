import { describe, it, expect } from "vitest";
import { ipInCidr, ipInAllowlist } from "../src/utils/cidr.js";

describe("ipInCidr (IPv4)", () => {
  it("matches an address inside a /27 range", () => {
    expect(ipInCidr("185.71.76.10", "185.71.76.0/27")).toBe(true);
  });
  it("rejects an address outside the range", () => {
    expect(ipInCidr("185.71.76.40", "185.71.76.0/27")).toBe(false);
  });
  it("handles a /32 single-address range", () => {
    expect(ipInCidr("77.75.156.11", "77.75.156.11/32")).toBe(true);
    expect(ipInCidr("77.75.156.12", "77.75.156.11/32")).toBe(false);
  });
  it("handles /0 matching everything", () => {
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
  });
});

describe("ipInCidr (IPv6)", () => {
  it("matches an address inside a /32 range", () => {
    expect(ipInCidr("2a02:5180::1", "2a02:5180::/32")).toBe(true);
    expect(ipInCidr("2a02:5180:1234:5678::1", "2a02:5180::/32")).toBe(true);
  });
  it("rejects an address outside the range", () => {
    expect(ipInCidr("2a02:5181::1", "2a02:5180::/32")).toBe(false);
  });
  it("handles an IPv4-mapped IPv6 address against an IPv4 CIDR by family mismatch (no match)", () => {
    expect(ipInCidr("::ffff:185.71.76.10", "185.71.76.0/27")).toBe(false);
  });
});

describe("ipInAllowlist", () => {
  it("matches if any range in a comma-separated list matches", () => {
    const allowlist = "185.71.76.0/27,185.71.77.0/27,2a02:5180::/32";
    expect(ipInAllowlist("185.71.77.5", allowlist)).toBe(true);
    expect(ipInAllowlist("2a02:5180::9", allowlist)).toBe(true);
    expect(ipInAllowlist("8.8.8.8", allowlist)).toBe(false);
  });
});
