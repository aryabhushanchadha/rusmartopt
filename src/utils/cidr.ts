/**
 * Minimal IPv4/IPv6 CIDR matching — no dependency, used to allowlist
 * ЮKassa's published webhook-sender ranges. Handles IPv4-mapped IPv6
 * addresses (::ffff:a.b.c.d), which is what Node sometimes reports for an
 * IPv4 peer depending on the socket family.
 */

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = (n << 8n) | BigInt(octet);
  }
  return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) {
    const v4 = ipv4ToBigInt(mapped[1]);
    return v4 === null ? null : (0xffffn << 32n) | v4;
  }

  const [head, tail] = ip.split("::");
  if (tail === undefined && ip.indexOf("::") === -1 && ip.split(":").length !== 8) return null;

  const headParts = head ? head.split(":").filter((p) => p !== "") : [];
  const tailParts = tail ? tail.split(":").filter((p) => p !== "") : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (ip.includes("::") && missing < 0) return null;
  if (!ip.includes("::") && headParts.length !== 8) return null;

  const groups = ip.includes("::")
    ? [...headParts, ...Array(missing).fill("0"), ...tailParts]
    : headParts;

  if (groups.length !== 8) return null;

  let n = 0n;
  for (const g of groups) {
    const val = parseInt(g || "0", 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
    n = (n << 16n) | BigInt(val);
  }
  return n;
}

function parseIp(ip: string): { value: bigint; bits: 32 | 128 } | null {
  const v4 = ipv4ToBigInt(ip);
  if (v4 !== null) return { value: v4, bits: 32 };
  const v6 = ipv6ToBigInt(ip);
  if (v6 !== null) return { value: v6, bits: 128 };
  return null;
}

/** Returns true if `ip` falls within the given CIDR range (e.g. "185.71.76.0/27"). */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const parsedIp = parseIp(ip);
  const parsedRange = parseIp(rangeIp);
  if (!parsedIp || !parsedRange || parsedIp.bits !== parsedRange.bits) return false;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsedIp.bits) return false;

  const bits = parsedIp.bits;
  const shift = BigInt(bits - prefix);
  const mask = shift === 0n ? (1n << BigInt(bits)) - 1n : ((1n << BigInt(bits)) - 1n) ^ ((1n << shift) - 1n);
  return (parsedIp.value & mask) === (parsedRange.value & mask);
}

/** Returns true if `ip` matches any CIDR in the comma-separated allowlist string. */
export function ipInAllowlist(ip: string, allowlist: string): boolean {
  const ranges = allowlist.split(",").map((s) => s.trim()).filter(Boolean);
  return ranges.some((range) => ipInCidr(ip, range));
}
