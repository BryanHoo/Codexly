import { Type, type Static } from "@sinclair/typebox";

export const NetworkProxySettingsSchema = Type.Object(
  {
    mode: Type.Union([Type.Literal("system"), Type.Literal("direct"), Type.Literal("custom")]),
    protocol: Type.Union([Type.Literal("http"), Type.Literal("https"), Type.Literal("socks5")]),
    host: Type.String({ maxLength: 253 }),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    username: Type.String({ maxLength: 1024 }),
    password: Type.Optional(Type.String({ maxLength: 1024 })),
  },
  { additionalProperties: false },
);
export type NetworkProxySettings = Omit<Static<typeof NetworkProxySettingsSchema>, "password"> & {
  password?: string | undefined;
};
export type NetworkProxyStatus = Omit<NetworkProxySettings, "password"> & { hasPassword: boolean };
export const DEFAULT_NETWORK_PROXY: NetworkProxySettings = {
  mode: "system",
  protocol: "http",
  host: "",
  port: 8080,
  username: "",
};

// 网关只接收主机名或 IP；禁止通过 URL 片段夹带凭据、路径或更改协议。
export function networkProxyUrl(settings: NetworkProxySettings): string | undefined {
  if (
    !["system", "direct", "custom"].includes(settings.mode) ||
    !["http", "https", "socks5"].includes(settings.protocol) ||
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65535 ||
    settings.host.length > 253 ||
    settings.username.length > 1024 ||
    (settings.password?.length ?? 0) > 1024
  )
    throw new Error("代理配置无效");
  if (settings.mode !== "custom") return undefined;
  const host = settings.host.trim().replace(/^\[|\]$/g, "");
  if (!host || /[\s/@?#\\]/.test(host)) throw new Error("代理配置无效");
  try {
    const url = new URL(
      `${settings.protocol}://${host.includes(":") ? `[${host}]` : host}:${String(settings.port)}`,
    );
    if (!url.hostname || (url.pathname && url.pathname !== "/")) throw new Error();
    url.username = settings.username;
    url.password = settings.password ?? "";
    return url.href;
  } catch {
    throw new Error("代理配置无效");
  }
}

export const NetworkProxyStatusSchema = Type.Object(
  {
    ...Type.Omit(NetworkProxySettingsSchema, ["password"]).properties,
    hasPassword: Type.Boolean(),
  },
  { additionalProperties: false },
);
