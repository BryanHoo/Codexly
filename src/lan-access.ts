import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

const MIN_LAN_PASSWORD_LENGTH = 16;
const MAX_LAN_PASSWORD_LENGTH = 128;
const UNIT_MS = {
  d: 24 * 60 * 60 * 1_000,
  h: 60 * 60 * 1_000,
  m: 60_000,
  ms: 1,
  s: 1_000,
} as const;
const VIRTUAL_INTERFACE_PATTERN =
  /^(?:awdl|br|bridge|docker|ham|llw|lo|tap|tun|utun|vboxnet|veth|virbr|wg|zt)(?:\d|[-_.]|$)|(?:openvpn|tailscale|vethernet|virtualbox|vmnet|zerotier)/iu;

export function parseSessionTtl(value: string): number {
  const match = /^(\d+)(ms|[smhd])$/u.exec(value);
  if (match === null) {
    throw new Error("Invalid session TTL; use a positive integer followed by ms, s, m, h, or d");
  }
  const amount = BigInt(match[1] ?? "0");
  const unit = match[2] as keyof typeof UNIT_MS;
  const milliseconds = amount * BigInt(UNIT_MS[unit]);
  if (milliseconds <= 0n || milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      "Invalid session TTL; duration must be a positive safe integer in milliseconds",
    );
  }
  return Number(milliseconds);
}

export function validateLanPassword(value: string): void {
  // 自定义 LAN 密码必须同时满足长度和字符类别要求，避免弱口令替代随机凭据。
  const hasRequiredStrength =
    value.length >= MIN_LAN_PASSWORD_LENGTH &&
    value.length <= MAX_LAN_PASSWORD_LENGTH &&
    /[A-Z]/u.test(value) &&
    /[a-z]/u.test(value) &&
    /[0-9]/u.test(value) &&
    /[^A-Za-z0-9]/u.test(value);
  if (!hasRequiredStrength) {
    throw new Error(
      "Invalid LAN password; expected 16 to 128 characters with uppercase, lowercase, number, and symbol",
    );
  }
}

export function generateLanPairingCode(): string {
  // 16 个随机字节提供 128 bit 熵，Base64URL 可安全人工传递且不会进入 URL。
  return randomBytes(16).toString("base64url");
}

function isPrivateIpv4(address: string): boolean {
  if (isIP(address) !== 4) {
    return false;
  }
  const [first = -1, second = -1] = address.split(".").map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isVirtualNetworkInterface(name: string): boolean {
  // Node.js 不暴露接口硬件类型，因此按各平台稳定命名排除隧道、虚拟网桥与容器接口。
  return VIRTUAL_INTERFACE_PATTERN.test(name);
}

export function listLanAccessUrls(
  port: number,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): readonly string[] {
  const addresses = Object.entries(interfaces)
    .filter(([name]) => !isVirtualNetworkInterface(name))
    .flatMap(([, entries]) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address))
    .map((entry) => entry.address);
  return [...new Set(addresses)]
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map((address) => `http://${address}:${String(port)}`);
}
