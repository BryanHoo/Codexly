import { RequestError } from "@agentclientprotocol/sdk/unstable";
import { AcpAuthenticationRequiredError } from "@codexly/core";
import type { AcpAgentProfile, AcpAuthStatus, AgentEngine } from "@codexly/protocol";
import type { AcpAgentLaunchOptions } from "./agent-launcher.js";
import type { AcpConnection } from "./connection.js";
import { waitForAcpPreview } from "./config-preview.js";
import { parseCodefreeAuthorization } from "./codefree-authorization.js";
import type { NativeConnection } from "./native-connection.js";
import type { AcpStoredSettings } from "./settings-store.js";

export async function connectForAcpInspection(
  connect: (signal?: AbortSignal, options?: AcpAgentLaunchOptions) => Promise<AcpConnection>,
  codefree: boolean,
  credential: string | undefined,
  signal?: AbortSignal,
): Promise<AcpConnection | undefined> {
  if (!codefree) return connect(signal, signal ? { signal } : undefined);
  // 干净安装先显示登录按钮，避免仅查看设置就启动厂商授权窗口。
  if (!credential) return;
  const pendingLogin = new AbortController();
  const lifetime = signal ? AbortSignal.any([signal, pendingLogin.signal]) : pendingLogin.signal;
  try {
    return await connect(lifetime, {
      signal: lifetime,
      onStderrLine: (line) => {
        if (parseCodefreeAuthorization(line)) pendingLogin.abort();
      },
    });
  } catch (error) {
    if (pendingLogin.signal.aborted || error instanceof AcpAuthenticationRequiredError) return;
    throw error;
  }
}

export async function inspectAcpAuth(
  engine: AgentEngine,
  connection: AcpConnection,
  codefree: boolean,
  antigravity: () => Promise<AcpAuthStatus>,
): Promise<AcpAuthStatus | undefined> {
  const status = await connection.readAuthStatus();
  if (status) return status;
  if (codefree) return { kind: "account", label: "CodeFree O" };
  if (engine === "acp-antigravity-acp") return antigravity();
}

/** 仅转发握手公布的能力和展示字段。 */
export function projectAcpAgentProfile(
  engine: AcpAgentProfile["engine"],
  initialization: AcpConnection["initialization"],
  authStatus: AcpAgentProfile["authStatus"],
  connection: AcpAgentProfile["connection"],
  authMethods?: AcpAgentProfile["authMethods"],
): AcpAgentProfile {
  return {
    engine,
    protocolVersion: initialization.protocolVersion,
    ...(authStatus ? { authStatus } : {}),
    ...(connection ? { connection } : {}),
    ...(initialization.agentCapabilities?.providers ? { providerConfiguration: true } : {}),
    agentInfo: {
      name: initialization.agentInfo?.name ?? engine,
      version: initialization.agentInfo?.version ?? "unknown",
      ...(initialization.agentInfo?.title ? { title: initialization.agentInfo.title } : {}),
    },
    authMethods:
      authMethods ??
      (initialization.authMethods ?? []).map((method) => ({
        id: method.id,
        name: method.name,
        ...(method.description ? { description: method.description } : {}),
        ...("type" in method ? { type: "terminal" as const } : {}),
      })),
  };
}

/** 优先报告生效的应用覆盖，只展示凭据是否存在。 */
export async function projectAcpConnectionSettings(
  saved: AcpStoredSettings,
  readNative: () => Promise<NativeConnection | undefined>,
): Promise<AcpAgentProfile["connection"]> {
  const active = Object.values(saved.providers ?? {}).find(
    (provider) => !saved.disabledProviders?.includes(provider.providerId),
  );
  const source = active ?? (await readNative());
  if (!source) return undefined;
  return {
    source: active ? "application" : "native",
    ...(source.baseUrl ? { baseUrl: source.baseUrl } : {}),
    apiType: source.apiType,
    hasCredentials: Object.keys(source.headers ?? {}).some((name) =>
      ["authorization", "x-api-key", "api-key"].includes(name.toLowerCase()),
    ),
    ...(active ? { providerId: active.providerId } : {}),
  };
}

/** Antigravity 的握手和历史列表在未登录时也成功，创建会话才会校验现有凭据。 */
export async function probeAntigravityAuth(
  connection: AcpConnection,
  cwd: string,
  releaseSession: (sessionId: string) => Promise<void>,
  closeConnection: () => Promise<void>,
): Promise<AcpAuthStatus> {
  const label = "Google Antigravity";
  const deadline = AbortSignal.timeout(15_000);
  try {
    const session = await waitForAcpPreview(
      connection.newSession({ cwd, mcpServers: [] }),
      deadline,
    ).catch((error: unknown) => {
      if (error instanceof RequestError && error.code === -32000) return undefined;
      throw error;
    });
    if (!session) return { kind: "none", label };
    // 设置服务先登记后台会话再释放，防止探测会话进入用户历史。
    await waitForAcpPreview(releaseSession(session.sessionId), deadline);
    // 订阅档位由厂商明确提供时才标记账号，其余成功会话只确认外部凭据可用。
    const metadata = session._meta?.["antigravity"];
    const hasTier =
      typeof metadata === "object" && metadata !== null && "tier" in metadata && !!metadata.tier;
    return { kind: hasTier ? "account" : "external", label };
  } catch (error) {
    await closeConnection().catch(() => undefined);
    throw error;
  }
}
