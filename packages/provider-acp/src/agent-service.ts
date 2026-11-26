import { readNativeConnection, type NativeConnection } from "./native-connection.js";
import * as acp from "@agentclientprotocol/sdk/unstable";
import type {
  AcpAuthCredentials,
  AcpAuthElicitationRequest,
  AcpAuthElicitationResponse,
} from "@codexly/protocol";
import { previewAcpConfig } from "./config-preview.js";
import type { AcpConfigPreviewRequest } from "@codexly/protocol";
import type { AcpAgentSettingsService } from "@codexly/core";
import type { AcpAgentProfile, AcpConfigValues, AcpDefaults, AgentEngine } from "@codexly/protocol";
import type { AcpAgentHandle, AcpAgentLauncher } from "./agent-launcher.js";
import type { AcpConnection } from "./connection.js";
import type { AcpSettingsStore } from "./settings-store.js";
import { prepareAcpDefaults } from "./configuration.js";
import { setAcpDefaultConfig } from "./default-config.js";
import { AcpProviderRouting } from "./provider-routing.js";
import { importAcpCatalog } from "./catalog-import.js";
import type { LocalCatalogStore } from "@codexly/core";
import { PendingRequestResolutionError } from "@codexly/core";
import { AcpElicitations } from "./elicitation.js";

const SETTINGS_CLOSE_TIMEOUT_MS = 1_000;

export class AcpAgentService implements AcpAgentSettingsService {
  readonly providers: NonNullable<AcpAgentSettingsService["providers"]>;
  #handle:
    | {
        launched: Promise<AcpAgentHandle>;
        ready: Promise<AcpAgentHandle>;
        connection: AcpConnection | undefined;
      }
    | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;
  #catalogImported = false;
  #inspected = false;
  #auth: { attemptId: string; elicitations: AcpElicitations } | undefined;
  constructor(
    readonly engine: AgentEngine,
    readonly cwd: string,
    readonly store: AcpSettingsStore,
    readonly launch: AcpAgentLauncher,
    readonly catalogStore?: LocalCatalogStore,
    readonly readNative: () => Promise<NativeConnection | undefined> = () =>
      readNativeConnection(engine),
  ) {
    const routing = new AcpProviderRouting(engine, store, this.readNative);
    this.providers = {
      list: () => this.#run(async () => routing.list(await this.#agent())),
      configure: (config) => this.#run(async () => routing.configure(await this.#agent(), config)),
      disable: (id) => this.#run(async () => routing.disable(await this.#agent(), id)),
    };
  }
  #run<T>(action: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("ACP 设置服务已关闭"));
    const result = this.#queue
      .catch(() => undefined)
      .then(() => {
        if (this.#closed) throw new Error("ACP 设置服务已关闭");
        return action();
      });
    this.#queue = result;
    return result;
  }
  async #agent(signal?: AbortSignal): Promise<AcpConnection> {
    if (!this.#handle) {
      // 迁移来源只读校验先于启动；失败不启动 agent，已保存的 ACP 配置由存储层优先保留。
      if (this.store.legacySource) await this.store.inspect(this.engine);
      signal?.throwIfAborted();
      const launched = this.launch(
        this.engine,
        {
          id: "acp-settings",
          kind: "temporary",
          rootPath: this.cwd,
          runtimeWorkspaceRoots: [this.cwd],
        },
        { supportsRequestElicitation: true },
      );
      // 原始启动句柄独立于供应商恢复，恢复请求挂起时仍可关闭传输。
      const current = {
        launched,
        ready: launched,
        connection: undefined as AcpConnection | undefined,
      };
      const pending = launched.then(async (handle) => {
        if (this.#handle !== current) throw new Error("ACP 设置连接已回收");
        current.connection = handle.connection;
        try {
          await new AcpProviderRouting(this.engine, this.store, this.readNative).restore(
            handle.connection,
          );
          return handle;
        } catch (error) {
          await this.#closeHandle(handle.connection);
          throw error;
        }
      });
      current.ready = pending;
      this.#handle = current;
      void pending
        .then((handle) => handle.connection.closed)
        .catch(() => undefined)
        .then(() => {
          if (this.#handle === current) this.#handle = undefined;
        });
    }
    return (await this.#handle.ready).connection;
  }
  inspect(): Promise<AcpAgentProfile> {
    return this.#run(async () => {
      // 显式刷新重建专用设置连接，让 adapter 重新读取外部 CLI 的登录和原生供应商配置。
      // 此连接不承载聊天，不会打断已有项目会话，也不读取或复制用户密钥。
      if (this.#inspected) await this.#closeHandle();
      const connection = await this.#agent();
      const { initialization } = connection;
      const authStatus = await connection.readAuthStatus();
      this.#inspected = true;
      const saved = await this.store.inspect(this.engine);
      const active = Object.values(saved.providers ?? {}).find(
        (provider) => !saved.disabledProviders?.includes(provider.providerId),
      );
      const native = active ? undefined : await this.readNative();
      const source = active ?? native;
      const connectionSettings = source
        ? {
            source: active ? ("application" as const) : ("native" as const),
            ...(source.baseUrl ? { baseUrl: source.baseUrl } : {}),
            apiType: source.apiType,
            hasCredentials: Object.keys(source.headers ?? {}).some((name) =>
              ["authorization", "x-api-key", "api-key"].includes(name.toLowerCase()),
            ),
            ...(active ? { providerId: active.providerId } : {}),
          }
        : undefined;
      return {
        engine: this.engine,
        protocolVersion: initialization.protocolVersion,
        ...(authStatus ? { authStatus } : {}),
        ...(connectionSettings ? { connection: connectionSettings } : {}),
        // 仅转发握手已公布的能力，界面不靠厂商名称猜测供应商接口。
        ...(initialization.agentCapabilities?.providers
          ? { providerConfiguration: true as const }
          : {}),
        agentInfo: {
          name: initialization.agentInfo?.name ?? this.engine,
          version: initialization.agentInfo?.version ?? "unknown",
          ...(initialization.agentInfo?.title ? { title: initialization.agentInfo.title } : {}),
        },
        authMethods: (initialization.authMethods ?? []).flatMap(
          (method): AcpAgentProfile["authMethods"] => {
            return [
              {
                id: method.id,
                name: method.name,
                ...(method.description ? { description: method.description } : {}),
                ...("type" in method ? { type: "terminal" } : {}),
              },
            ];
          },
        ),
      };
    });
  }
  authenticate(
    methodId: string,
    signal?: AbortSignal,
    credentials?: AcpAuthCredentials,
    attemptId?: string,
  ): Promise<Record<string, never>> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      const connection = await this.#agent();
      signal?.throwIfAborted();
      const method = connection.initialization.authMethods?.find((value) => value.id === methodId);
      if (!method) throw new Error("ACP 认证方式未公布");
      if ("type" in method) throw new Error("当前宿主未启用 ACP 终端认证");
      const elicitations =
        attemptId === undefined ? undefined : new AcpElicitations("acp-settings", () => undefined);
      if (attemptId !== undefined && elicitations) this.#auth = { attemptId, elicitations };
      const info = connection.initialization.agentInfo;
      const agent = [info?.title, info?.name].find((label) => label?.trim()) ?? this.engine;
      const authenticate = () =>
        connection.transport.agent.request(
          acp.methods.agent.authenticate,
          {
            methodId,
            ...(credentials?.apiKey
              ? { _meta: { "api-key": { apiKey: credentials.apiKey } } }
              : {}),
          },
          signal ? { cancellationSignal: signal, stopWaitingOnCancel: true } : undefined,
        );
      try {
        if (connection.requestElicitation && elicitations && attemptId !== undefined) {
          await connection.requestElicitation.run(
            acp.methods.agent.authenticate,
            {
              request: (input, lifetime) =>
                elicitations.request(
                  this.engine,
                  attemptId,
                  agent,
                  input,
                  signal ? AbortSignal.any([signal, lifetime]) : lifetime,
                ),
              complete: (id) => {
                elicitations.complete(id);
              },
            },
            authenticate,
          );
        } else await authenticate();
        signal?.throwIfAborted();
        return {};
      } finally {
        this.#auth = undefined;
        elicitations?.clear();
        // 认证使用独立连接；取消仅回收这个服务进程，不中断项目中的聊天。
        if (signal?.aborted) await this.#closeHandle();
      }
    });
  }
  authElicitation(input: AcpAuthElicitationRequest): AcpAuthElicitationResponse {
    // 查询与答复须绕过设置串行队列，认证正在队列头等待用户交互。
    const elicitations =
      this.#auth?.attemptId === input.attemptId ? this.#auth.elicitations : undefined;
    if ("requestId" in input) {
      const request = elicitations
        ?.list(this.engine)
        .find(({ requestId }) => requestId === input.requestId);
      if (!request || !elicitations)
        throw new PendingRequestResolutionError("not_found", "ACP 认证问卷已结束");
      elicitations.resolve({
        projectId: request.projectId,
        taskId: request.taskId,
        turnId: request.turnId,
        itemId: request.itemId,
        type: request.type,
        requestId: request.requestId,
        resolution: input.resolution,
      });
    }
    return elicitations?.listWithExternalStatus(this.engine) ?? [];
  }
  previewConfig(cwd: string, input: AcpConfigPreviewRequest, signal?: AbortSignal) {
    // 与认证和默认值共用串行连接，但只读取私有设置快照，不进行任何持久写入。
    return this.#run(async () => {
      signal?.throwIfAborted();
      const cancelled = Promise.withResolvers<never>();
      const onAbort = () => {
        cancelled.reject(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        // 从启动到会话清理都参与取消竞速，Agent 不回应也能退出串行队列。
        const preview = (async () => {
          const connection = await this.#agent(signal);
          signal?.throwIfAborted();
          const saved = await this.store.inspect(this.engine);
          signal?.throwIfAborted();
          return previewAcpConfig(connection, cwd, saved, input.values, input.change, {
            releaseSession: (id) => this.#closeSession(connection, id),
            ...(input.includeCommands ? { includeCommands: true } : {}),
          });
        })();
        const result = await Promise.race([preview, cancelled.promise]);
        signal?.throwIfAborted();
        return result;
      } catch (error) {
        // 预览关闭失败或取消后释放独立设置连接，不影响项目中的聊天连接。
        await this.#closeHandle().catch(() => undefined);
        signal?.throwIfAborted();
        throw error;
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    });
  }
  readDefaults(): Promise<AcpDefaults> {
    return this.#run(() => this.#defaults());
  }
  importCatalog(catalog: LocalCatalogStore, signal?: AbortSignal): Promise<void> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      await importAcpCatalog(this.engine, await this.#agent(), catalog, signal);
      if (catalog === this.catalogStore) this.#catalogImported = true;
    });
  }
  updateDefaults(values: AcpConfigValues): Promise<AcpDefaults> {
    return this.#run(() => this.#defaults(structuredClone(values)));
  }
  setDefaultConfig(configId: string, value: string | boolean): Promise<AcpDefaults> {
    return this.#run(async () => {
      const connection = await this.#agent();
      return setAcpDefaultConfig(
        connection,
        this.store,
        this.engine,
        this.cwd,
        configId,
        value,
        (id) => this.#closeSession(connection, id),
      );
    });
  }
  async #defaults(values?: AcpConfigValues): Promise<AcpDefaults> {
    const connection = await this.#agent();
    const session = await connection.newSession({ cwd: this.cwd, mcpServers: [] });
    const validated = await (async () => {
      try {
        const current =
          values === undefined
            ? await this.store.inspect(this.engine)
            : await this.store.read(this.engine);
        const prepared = await prepareAcpDefaults(
          connection,
          session.sessionId,
          session.configOptions,
          current,
          values,
          values === undefined,
        );
        return { ...prepared, retainedValues: current.retainedValues };
      } finally {
        await this.#closeSession(connection, session.sessionId);
      }
    })();
    const { configOptions, defaults, migration, invalidDefaults } = validated;
    await this.#discover(connection);
    // agent 拒绝、连接或关闭失败时不会写默认值；legacy 只在私有记录中留存。
    // 查看和草稿预览不落盘；只有明确提交完整默认值后才写用户配置。
    if (values !== undefined)
      await this.store.update(this.engine, (latest) => ({
        ...latest,
        ...(migration ? { migration } : {}),
        values: defaults,
        configured: true,
      }));
    return {
      configOptions,
      defaults,
      unmappedLegacy: [
        ...new Set([
          ...(migration?.unmapped ?? []),
          ...Object.keys(validated.retainedValues ?? {}),
        ]),
      ],
      invalidDefaults,
    };
  }
  async #discover(connection: AcpConnection, signal?: AbortSignal): Promise<void> {
    // 只有实际认证/配置会话成功后才发现目录；空首屏不探测未配置引擎，成功后本进程只扫描一次。
    if (
      !this.catalogStore ||
      this.#catalogImported ||
      !connection.initialization.agentCapabilities?.sessionCapabilities?.list
    )
      return;
    if (connection.transport.signal.aborted) connection = await this.#agent(signal);
    await importAcpCatalog(this.engine, connection, this.catalogStore, signal);
    this.#catalogImported = true;
  }
  async close(): Promise<void> {
    this.#closed = true;
    // 先关闭传输以解除认证等待，再等待串行操作退场。
    await this.#closeHandle();
    await this.#queue.catch(() => undefined);
  }
  async #closeSession(connection: AcpConnection, sessionId: string): Promise<void> {
    // 设置服务独占连接；最小 v1 Agent 没有 close 时直接回收进程释放临时会话。
    if (!connection.canCloseSessions) {
      await this.#closeHandle(connection);
      return;
    }
    try {
      await connection.closeSession(sessionId);
    } catch (error) {
      await this.#closeHandle(connection);
      throw error;
    }
  }
  async #closeHandle(connection?: AcpConnection): Promise<void> {
    const current = this.#handle;
    // 迟到的旧会话清理不能关闭后续设置操作创建的新连接。
    if (!current || (connection && current.connection !== connection)) return;
    this.#handle = undefined;
    const cleanup = current.launched.then(
      async (handle) => {
        handle.connection.close();
        await handle.close();
      },
      () => undefined,
    );
    // 启动和进程退出均可能失去响应；超时后释放队列，迟到句柄仍执行回收。
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        cleanup,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, SETTINGS_CLOSE_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
