import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { AgentTaskScope, LocalCatalogStore } from "@codexly/core";
import type { AcpConfigOption, AgentEngine } from "@codexly/protocol";
import type { AcpAgentCatalog } from "./agent-catalog.js";
import type { AcpAgentHandle, AcpAgentLauncher } from "./agent-launcher.js";
import type { AcpClientCallbacks, AcpConnection } from "./connection.js";
import type { AcpSettingsStore, AcpStoredSettings } from "./settings-store.js";
import type { AcpStorageLeases } from "./storage-lease.js";
import { findAgentExecutable } from "./agent-executable.js";
import { AcpProviderRouting } from "./provider-routing.js";
import { AcpStartupConfig } from "./startup-config.js";
import { prepareAcpDefaults } from "./configuration.js";
import { previewAcpConfig, waitForAcpPreview } from "./config-preview.js";
import { CODEFREE_ENGINE, codefreeCredentialRevision } from "./codefree-authorization.js";

/** 启动快照共用宿主设置身份，独立探测进程仅在私有工作区运行。 */
interface StartupRuntime {
  directory: string;
  catalog: AcpAgentCatalog;
  settings: AcpSettingsStore;
  launch: AcpAgentLauncher;
  store: LocalCatalogStore;
}

export function createAcpStartupConfig(
  { directory, catalog, settings: settingsStore, launch, store }: StartupRuntime,
  leases: AcpStorageLeases,
  environment: NodeJS.ProcessEnv,
) {
  const cache = new AcpStartupConfig(
    join(directory, "config-cache"),
    async (engine) => {
      const command = await catalog.command(engine);
      const env = { ...environment, ...command.env };
      const executable = isAbsolute(command.command)
        ? command.command
        : await findAgentExecutable(command.command, env);
      const native =
        engine === "codex"
          ? env["CODEX_PATH"]
          : engine === "claude"
            ? env["CLAUDE_CODE_EXECUTABLE"]
            : undefined;
      const paths = new Set(
        [executable, command.args[0], native].filter(
          (path): path is string => path !== undefined && isAbsolute(path),
        ),
      );
      const [files, revision, settings] = await Promise.all([
        Promise.all(
          [...paths].map(async (path) => {
            const info = await stat(path).catch(() => undefined);
            return [path, info?.ino, info?.mtimeMs, info?.size];
          }),
        ),
        engine === CODEFREE_ENGINE ? codefreeCredentialRevision(env) : undefined,
        settingsStore.inspect(engine),
      ]);
      // 只写入身份摘要，命令环境和设置里的认证信息留在宿主。
      return createHash("sha256")
        .update(JSON.stringify([command, files, revision, settings]))
        .digest("hex");
    },
    leases,
  );
  async function probe(engine: AgentEngine, signal: AbortSignal) {
    const cwd = join(directory, "config-cache", "workspace");
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    signal.throwIfAborted();
    const handle = await launch(
      engine,
      {
        id: "acp-config-cache",
        kind: "temporary",
        rootPath: cwd,
        runtimeWorkspaceRoots: [cwd],
      },
      {},
      { signal, handshakeTimeoutMs: 8_000 },
    );
    try {
      signal.throwIfAborted();
      const connection = handle.connection;
      const restored = async () => {
        await new AcpProviderRouting(engine, settingsStore).restore(connection);
        const saved = await settingsStore.inspect(engine);
        signal.throwIfAborted();
        return previewAcpConfig(connection, cwd, saved, {}, undefined, {
          includeCommands: true,
          registerSession: async (sessionId) => {
            await store.catalog("acp.session.background", { engine, sessionId });
          },
          releaseSession: async (sessionId) => {
            if (connection.canCloseSessions && !signal.aborted)
              await connection.closeSession(sessionId);
          },
        });
      };
      return await waitForAcpPreview(restored(), signal);
    } finally {
      // 独立探测进程的取消只释放自身，真实会话可以立即启动。
      await handle.close().catch(() => undefined);
    }
  }
  return {
    cache,
    read: (engine: AgentEngine) => cache.read(engine),
    refresh: (engine: AgentEngine, signal?: AbortSignal) =>
      cache.refresh(engine, (active) => probe(engine, active), signal),
  };
}

const bindings = new WeakMap<AcpConnection, Promise<string | undefined>>();

export function initializeStartupAwareSession(
  cache: AcpStartupConfig,
  settings: AcpSettingsStore,
  engine: AgentEngine,
) {
  return async (
    connection: AcpConnection,
    sessionId: string,
    options: AcpConfigOption[],
    frozen?: AcpStoredSettings,
  ) => {
    const applied = frozen ?? (await settings.read(engine));
    const { configOptions } = await prepareAcpDefaults(connection, sessionId, options, applied);
    void bindings
      .get(connection)
      ?.then(async (binding) => {
        if (binding === undefined) return;
        // 恢复旧任务时冻结过的设置可能已被修改，旧值不能进入全局菜单。
        if (JSON.stringify(applied) === JSON.stringify(await settings.inspect(engine)))
          await cache.rememberDefaults(engine, binding, configOptions);
      })
      .catch(() => undefined);
    return configOptions;
  };
}

/** 仅在会话公布不同配置时学习，磁盘操作独立于协议流和发送回执。 */
function observeAcpConnection(
  cache: AcpStartupConfig,
  engine: AgentEngine,
  callbacks: AcpClientCallbacks,
  binding: Promise<string | undefined>,
): AcpClientCallbacks {
  let lastOptions = "";
  return {
    ...callbacks,
    onSessionState: (sessionId, state) => {
      const emitted = callbacks.onSessionState?.(sessionId, state);
      if (state.configOptions.length > 0) {
        const signature = JSON.stringify(state.configOptions);
        if (signature !== lastOptions) {
          lastOptions = signature;
          void binding.then((current) =>
            current === undefined ? undefined : cache.observe(engine, current, state.configOptions),
          );
        }
      }
      return emitted;
    },
  };
}

/** 管理项目连接的关闭回执，并在旁路学习真实 Agent 公布的配置。 */
export function startupAwareAcpConnector(
  runtime: Pick<StartupRuntime, "launch" | "settings">,
  scope: AgentTaskScope,
  engine: AgentEngine,
  cache: AcpStartupConfig,
  handles: Set<AcpAgentHandle>,
  reapByEngine: Map<AgentEngine, Promise<void>>,
) {
  return async (callbacks: AcpClientCallbacks) => {
    // 协议流关闭不代表子进程已退出。重连前先回收旧进程，避免两个 Agent 同时占用原会话。
    await reapByEngine.get(engine);
    const binding = cache.binding(engine).catch(() => undefined);
    const handle = await runtime.launch(
      engine,
      scope,
      observeAcpConnection(cache, engine, callbacks, binding),
    );
    bindings.set(handle.connection, binding);
    // 在会话创建/恢复前恢复 ACP 路由；失败回收本次连接，不回退到默认供应商。
    try {
      await new AcpProviderRouting(engine, runtime.settings).restore(handle.connection);
    } catch (error) {
      await handle.close();
      throw error;
    }
    handles.add(handle);
    const reaped = handle.connection.closed.then(() => handle.close());
    reapByEngine.set(engine, reaped);
    void reaped
      .finally(() => {
        handles.delete(handle);
        if (reapByEngine.get(engine) === reaped) reapByEngine.delete(engine);
      })
      .catch(() => undefined);
    return handle.connection;
  };
}
