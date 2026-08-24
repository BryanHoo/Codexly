import type { NetworkInterfaceInfo } from "node:os";

import { describe, expect, it } from "vitest";

import {
  generateLanPairingCode,
  listLanAccessUrls,
  parseSessionTtl,
  validateLanPassword,
} from "./lan-access.js";

describe("LAN access helpers", () => {
  it("parses any positive safe duration in supported units", () => {
    expect(parseSessionTtl("1ms")).toBe(1);
    expect(parseSessionTtl("59s")).toBe(59_000);
    expect(parseSessionTtl("1m")).toBe(60_000);
    expect(parseSessionTtl("12h")).toBe(43_200_000);
    expect(parseSessionTtl("181d")).toBe(15_638_400_000);
    for (const invalid of ["0ms", "1.5h", "1w", "999999999999999999999d", " 1h"]) {
      expect(() => parseSessionTtl(invalid)).toThrow(/session TTL/u);
    }
  });

  it("accepts only high-strength custom LAN passwords", () => {
    expect(() => {
      validateLanPassword("Strong-Lan_Pass9!");
    }).not.toThrow();

    for (const invalid of [
      "Short1!a",
      `${"A".repeat(125)}a1!x`,
      "lowercase-password9!",
      "UPPERCASE-PASSWORD9!",
      "Password-Without-Digit!",
      "PasswordWithoutSymbol9",
    ]) {
      expect(() => {
        validateLanPassword(invalid);
      }).toThrow(/LAN password/u);
    }
  });

  it("generates URL-safe codes with at least 128 bits of randomness", () => {
    const first = generateLanPairingCode();
    const second = generateLanPairingCode();
    expect(first).toMatch(/^[A-Za-z0-9_-]{22,}$/u);
    expect(second).not.toBe(first);
  });

  it("lists only physical-interface private IPv4 LAN URLs in stable order", () => {
    const ipv4 = (address: string, internal = false): NetworkInterfaceInfo => ({
      address,
      cidr: `${address}/24`,
      family: "IPv4",
      internal,
      mac: "00:00:00:00:00:00",
      netmask: "255.255.255.0",
    });
    const urls = listLanAccessUrls(3210, {
      en0: [ipv4("192.168.1.20"), ipv4("127.0.0.1", true)],
      "Wi-Fi": [ipv4("10.0.0.8"), ipv4("192.168.1.20")],
      "Broadcom Ethernet": [ipv4("172.16.0.2")],
      en1: [
        ipv4("8.8.8.8"),
        ipv4("198.18.0.1"),
        {
          address: "fe80::1",
          cidr: "fe80::1/64",
          family: "IPv6",
          internal: false,
          mac: "00:00:00:00:00:00",
          netmask: "ffff:ffff:ffff:ffff::",
          scopeid: 1,
        },
      ],
      utun5: [ipv4("41.10.1.29")],
      bridge100: [ipv4("192.168.139.3")],
      docker0: [ipv4("172.17.0.1")],
      invalid: [ipv4("not-an-ip")],
    });

    expect(urls).toEqual([
      "http://10.0.0.8:3210",
      "http://172.16.0.2:3210",
      "http://192.168.1.20:3210",
    ]);
  });
});
