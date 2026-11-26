import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
  Agent,
  EnvHttpProxyAgent,
  ProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
  fetch as proxyFetch,
} from "undici";
import { Server } from "proxy-chain";
import {
  DEFAULT_NETWORK_PROXY,
  NetworkProxySettingsSchema,
  networkProxyUrl,
  type NetworkProxySettings,
  type NetworkProxyStatus,
} from "@codexly/protocol";

export async function loadNetworkProxy(directory: string): Promise<NetworkProxySettings> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(directory, "network-proxy.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_NETWORK_PROXY };
    // 原始解析错误可能包含密码片段，只允许固定错误跨边界。
    // oxlint-disable-next-line preserve-caught-error
    throw new Error("无法读取 .codexly/network-proxy.json 中的网络代理配置");
  }
  if (!Value.Check(NetworkProxySettingsSchema, value)) throw new Error("代理配置无效");
  networkProxyUrl(value);
  return value;
}
export async function readNetworkProxy(directory: string): Promise<NetworkProxyStatus> {
  const { password, ...settings } = await loadNetworkProxy(directory);
  return { ...settings, hasPassword: Boolean(password) };
}
export async function saveNetworkProxy(
  directory: string,
  input: NetworkProxySettings,
): Promise<NetworkProxyStatus> {
  if (!Value.Check(NetworkProxySettingsSchema, input)) throw new Error("代理配置无效");
  networkProxyUrl(input);
  const previous = await loadNetworkProxy(directory);
  const settings = { ...input, password: input.password ?? previous.password ?? "" };
  await mkdir(directory, { recursive: true });
  const target = join(directory, "network-proxy.json"),
    temporary = `${target}.${randomUUID()}.tmp`;
  try {
    // 独占私有临时文件完整落盘后原子替换；密码不进入日志或接口响应。
    await writeFile(temporary, JSON.stringify(settings), { mode: 0o600, flag: "wx" });
    if (process.platform !== "win32") await chmod(temporary, 0o600);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  const { password, ...publicSettings } = settings;
  return { ...publicSettings, hasPassword: Boolean(password) };
}
const PROXY_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
];
export function proxyEnvironment(
  settings: NetworkProxySettings,
  base: NodeJS.ProcessEnv,
  override?: string,
): NodeJS.ProcessEnv {
  const env = { ...base };
  if (settings.mode === "system") return env;
  for (const key of PROXY_KEYS) Reflect.deleteProperty(env, key);
  if (settings.mode === "direct") {
    // 空字符串覆盖 SDK 用户配置中的代理；NO_PROXY=* 同时保护读取原生设置的客户端。
    for (const key of PROXY_KEYS) env[key] = key.toLowerCase() === "no_proxy" ? "*" : "";
  }
  if (settings.mode === "custom") {
    const url = override ?? requiredProxyUrl(settings);
    for (const key of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
    ])
      env[key] = url;
    env["NO_PROXY"] = env["no_proxy"] = "localhost,127.0.0.1,::1";
  }
  return env;
}

let systemEnvironment: NodeJS.ProcessEnv | undefined;
function systemProxyOptions(base: NodeJS.ProcessEnv) {
  const httpProxy =
    base["http_proxy"] ?? base["HTTP_PROXY"] ?? base["all_proxy"] ?? base["ALL_PROXY"] ?? "";
  return {
    httpProxy,
    httpsProxy: base["https_proxy"] ?? base["HTTPS_PROXY"] ?? httpProxy,
    noProxy: base["no_proxy"] ?? base["NO_PROXY"] ?? "",
    proxyTunnel: true,
  };
}

/** Bun 的兼容 Agent 仅保存配置，没有独立 destroy；Node 的连接池仍按正式接口回收。 */
async function destroyDispatcher(dispatcher: { destroy?: () => Promise<void> }): Promise<void> {
  await dispatcher.destroy?.();
}

export async function initializeNetworkProxy(
  directory: string,
  base = process.env,
  snapshot?: unknown,
) {
  const settings = snapshot ?? (await loadNetworkProxy(directory));
  if (!Value.Check(NetworkProxySettingsSchema, settings)) throw new Error("代理配置无效");
  const previous = getGlobalDispatcher();
  let bridge: Server | undefined;
  let url = networkProxyUrl(settings);
  if (settings.mode === "custom" && settings.protocol === "socks5") {
    // 统一将 SOCKS 转成引擎可用的 HTTP 入口；保持流式传输和 TLS 端到端校验。
    const upstream = requiredProxyUrl(settings).replace("socks5:", "socks5h:");
    bridge = new Server({
      host: "127.0.0.1",
      port: 0,
      verbose: false,
      prepareRequestFunction: () => ({ upstreamProxyUrl: upstream }),
    });
    await bridge.listen();
    url = `http://127.0.0.1:${String(bridge.port)}`;
  }
  const env = proxyEnvironment(settings, base, url);
  const dispatcher =
    settings.mode === "direct"
      ? new Agent()
      : new EnvHttpProxyAgent(
          settings.mode === "custom"
            ? {
                httpProxy: url ?? requiredProxyUrl(settings),
                httpsProxy: url ?? requiredProxyUrl(settings),
                noProxy: "localhost,127.0.0.1,::1",
                proxyTunnel: true,
              }
            : systemProxyOptions(base),
        );
  const previousSystemEnvironment = systemEnvironment;
  systemEnvironment = { ...base };
  setGlobalDispatcher(dispatcher);
  const originalFetch = globalThis.fetch;
  // Bun 编译宿主的内建 fetch 不消费 Undici dispatcher；统一使用同一 HTTP 实现。
  globalThis.fetch = proxyFetch as typeof globalThis.fetch;
  // SDK 与其子进程读取进程环境；保留非代理环境，避免污染宿主其他设置。
  const original = Object.fromEntries(PROXY_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_KEYS) {
    if (env[key] === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = env[key];
  }
  return {
    env,
    async close() {
      systemEnvironment = previousSystemEnvironment;
      globalThis.fetch = originalFetch;
      setGlobalDispatcher(previous);
      for (const key of PROXY_KEYS) {
        if (original[key] === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = original[key];
      }
      try {
        await destroyDispatcher(dispatcher);
      } finally {
        // 连接池清理失败也不能遗留监听中的 SOCKS 转接，避免 agent 在 EOF 后无法退出。
        await bridge?.close(true);
      }
    },
  };
}

// 独立连接测试不修改全局出口；无论成功失败都释放连接池，不回传底层错误中的凭据。
export async function testNetworkProxy(
  directory: string,
  input: NetworkProxySettings,
): Promise<void> {
  const saved = await loadNetworkProxy(directory);
  const settings = { ...input, password: input.password ?? saved.password };
  const url = networkProxyUrl(settings);
  const dispatcher =
    settings.mode === "custom"
      ? new ProxyAgent(url ?? requiredProxyUrl(settings))
      : settings.mode === "direct"
        ? new Agent()
        : new EnvHttpProxyAgent(systemProxyOptions(systemEnvironment ?? process.env));
  try {
    const { statusCode, body } = await dispatcher.request({
      origin: "https://example.com",
      path: "/",
      method: "HEAD",
      signal: AbortSignal.timeout(10000),
    });
    await body.dump();
    if (statusCode >= 400) throw new Error();
  } catch {
    throw new Error("代理连接测试失败，请检查网关、认证和网络");
  } finally {
    await destroyDispatcher(dispatcher);
  }
}

function requiredProxyUrl(settings: NetworkProxySettings): string {
  const url = networkProxyUrl(settings);
  if (!url) throw new Error("代理配置无效");
  return url;
}
