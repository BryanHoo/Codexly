import { readConnectedQuota } from "./account-quota.js";
import { readNativeConnection, type NativeConnection } from "./native-connection.js";
import * as acp from "@agentclientprotocol/sdk/unstable";
import type {
  AcpAgentProfile,
  AcpAuthCredentials,
  AcpAuthElicitationRequest,
  AcpAuthElicitationResponse,
  AcpConfigPreview,
  AcpConfigPreviewRequest,
  AcpConfigValues,
  AcpDefaults,
  AcpSettingsSnapshot,
  AgentEngine,
  AgentQuotaView,
} from "@codexly/protocol";
import { createAcpPreviewReader, previewAcpConfig, waitForAcpPreview } from "./config-preview.js";
import {
  connectForAcpInspection,
  inspectAcpAuth,
  probeAntigravityAuth,
  projectAcpAgentProfile,
  projectAcpConnectionSettings,
} from "./agent-auth-profile.js";
import type { AcpAgentSettingsService, AgentTaskScope } from "@codexly/core";
import {
  closeAcpAgentHandle,
  type AcpAgentHandle,
  type AcpAgentLaunchOptions,
  type AcpAgentLauncher,
} from "./agent-launcher.js";
import type { AcpConnection } from "./connection.js";
import type { AcpSettingsStore } from "./settings-store.js";
import {
  closeAcpSettingsSession,
  readAcpSettingsConfiguration,
  type InspectWithSession,
  projectAcpDefaults,
  readAcpDefaults,
  setAcpDefaultConfig,
} from "./default-config.js";
import { AcpProviderRouting } from "./provider-routing.js";
import { importAcpCatalog } from "./catalog-import.js";
import type { LocalCatalogStore } from "@codexly/core";
import { PendingRequestResolutionError } from "@codexly/core";
import { AcpElicitations } from "./elicitation.js";
import {
  authorizeCodefree,
  CODEFREE_LOGIN,
  codefreeSignedOutProfile,
} from "./codefree-authorization.js";
import { previewCodefreeModels, type ReadCodefreeModels } from "./codefree-models.js";

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
  #settingsDiscovery: Promise<void> | undefined;
  #inspected = false;
  #auth: { attemptId: string; elicitations: AcpElicitations } | undefined;
  #codefreeLogin: AbortController | undefined;
  readonly #previewCached: ReturnType<typeof createAcpPreviewReader>;
  #verifiedCredential: string | undefined;
  constructor(
    readonly engine: AgentEngine,
    readonly cwd: string,
    readonly store: AcpSettingsStore,
    readonly launch: AcpAgentLauncher,
    readonly catalogStore?: LocalCatalogStore,
    readonly readNative: () => Promise<NativeConnection | undefined> = () =>
      readNativeConnection(engine),
    readonly codefreeRevision?: () => Promise<string | undefined>,
    readonly projectPreview?: <T>(
      scope: AgentTaskScope,
      run: (connection: AcpConnection) => Promise<T>,
    ) => Promise<T>,
    readonly readModels?: ReadCodefreeModels,
    readonly nativeQuota?: (signal?: AbortSignal) => Promise<AgentQuotaView>,
    readonly invalidateSettingsSnapshot?: () => Promise<void>,
  ) {
    this.#previewCached = createAcpPreviewReader(() => store.inspect(engine), codefreeRevision);
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
  async #agent(signal?: AbortSignal, options?: AcpAgentLaunchOptions): Promise<AcpConnection> {
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
        { ...options, allowDisabled: true },
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
  readQuota(signal?: AbortSignal) {
    if (this.nativeQuota) return this.nativeQuota(signal);
    return this.#run(async () => {
      signal?.throwIfAborted();
      await this.#agent(signal);
      const handle = await this.#handle?.ready;
      if (!handle) throw new Error("Agent 连接已关闭");
      return readConnectedQuota(handle, signal);
    });
  }
  inspect(): Promise<AcpAgentProfile> {
    return this.#run(() => this.#inspect());
  }

  async #inspect(
    signal?: AbortSignal,
    onAntigravitySession?: Parameters<InspectWithSession>[0],
  ): Promise<AcpAgentProfile> {
    // 通用 Agent 刷新时重建连接；CodeFree O 用授权文件变更判断是否需要重握手。
    const credential = await this.codefreeRevision?.();
    if (this.#inspected && (!credential || credential !== this.#verifiedCredential))
      await this.#closeHandle();
    const isCodefree = !!this.codefreeRevision;
    const connection = await connectForAcpInspection(
      (active, options) => this.#agent(active, options),
      isCodefree,
      credential,
      signal,
    );
    if (!connection) return codefreeSignedOutProfile;
    const authStatus = await inspectAcpAuth(this.engine, connection, isCodefree, () =>
      probeAntigravityAuth(
        connection,
        this.cwd,
        async (id) => {
          await this.#registerBackground(id);
          try {
            signal?.throwIfAborted();
            await onAntigravitySession?.(connection, id);
          } finally {
            await this.#closeSession(connection, id, !!signal);
          }
        },
        () => this.#closeHandle(connection),
      ),
    );
    this.#inspected = true;
    // 厂商会在 initialize 内刷新本地凭据，以下一次读取可见的版本作为基准。
    this.#verifiedCredential =
      credential === this.#verifiedCredential ? credential : await this.codefreeRevision?.();
    const saved = await this.store.inspect(this.engine);
    const connectionSettings = await projectAcpConnectionSettings(saved, () => this.readNative());
    return projectAcpAgentProfile(
      this.engine,
      connection.initialization,
      authStatus,
      connectionSettings,
      this.codefreeRevision ? codefreeSignedOutProfile.authMethods : undefined,
    );
  }

  /** 快照读取与设置写入共享连接生命周期，后台目录导入独立于响应。 */
  readSettingsSnapshot(signal: AbortSignal): Promise<AcpSettingsSnapshot> {
    return this.#run(async () => {
      signal.throwIfAborted();
      try {
        const snapshot = await waitForAcpPreview(
          readAcpSettingsConfiguration(
            this.engine,
            this.store,
            signal,
            (onSession) => this.#inspect(signal, onSession),
            () => this.#defaults(undefined, signal),
          ),
          signal,
        );
        if (snapshot.defaults) this.#discoverSettingsHistory();
        return snapshot;
      } catch (error) {
        if (signal.aborted) await this.#closeHandle();
        throw error;
      }
    });
  }

  #discoverSettingsHistory() {
    const connection = this.#handle?.connection;
    if (this.#settingsDiscovery || !connection || connection.transport.signal.aborted) return;
    this.#settingsDiscovery = this.#discover(connection, connection.transport.signal)
      .catch(() => undefined)
      .finally(() => {
        this.#settingsDiscovery = undefined;
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
      if (this.codefreeRevision && methodId === CODEFREE_LOGIN) {
        if (!attemptId) throw new Error("CodeFree O 登录需要认证交互标识");
        const controller = new AbortController();
        const lifetime = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
        const elicitations = new AcpElicitations("acp-settings", () => undefined);
        this.#codefreeLogin = controller;
        this.#auth = { attemptId, elicitations };
        try {
          this.#verifiedCredential = undefined;
          await this.#closeHandle();
          lifetime.throwIfAborted();
          await authorizeCodefree(this.launch, this.cwd, attemptId, elicitations, lifetime);
          await this.invalidateSettingsSnapshot?.().catch(() => undefined);
          lifetime.throwIfAborted();
          return {};
        } finally {
          this.#codefreeLogin = undefined;
          this.#auth = undefined;
          elicitations.clear();
        }
      }
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
        await this.invalidateSettingsSnapshot?.().catch(() => undefined);
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
  async previewConfig(
    cwd: string,
    input: AcpConfigPreviewRequest,
    signal?: AbortSignal,
    scope?: AgentTaskScope,
  ): Promise<AcpConfigPreview> {
    const registerSession = (id: string) => this.#registerBackground(id);
    if (scope && this.projectPreview) {
      if (this.readModels) {
        const catalog = await previewCodefreeModels(cwd, input, signal, this.readModels, (load) =>
          this.#previewCached(cwd, input, undefined, load),
        );
        // 原生读取失败时复用后台完整预览，共享同一个临时会话。
        if (catalog === "fallback") input = { ...input, includeCommands: true };
        else if (catalog) return catalog;
      }
      const preview = this.projectPreview;
      const options = { ...input, registerSession };
      return waitForAcpPreview(
        this.#previewCached(cwd, input, signal, (saved) =>
          preview(scope, (connection) =>
            previewAcpConfig(connection, cwd, saved, input.values, input.change, options),
          ),
        ),
        signal,
      );
    }
    // 与认证和默认值共用串行连接，预览只读取私有设置快照。
    return this.#run(async () => {
      signal?.throwIfAborted();
      try {
        const load = async (saved?: Awaited<ReturnType<AcpSettingsStore["inspect"]>>) => {
          const connection = await this.#agent(signal);
          signal?.throwIfAborted();
          const settings = saved ?? (await this.store.inspect(this.engine));
          signal?.throwIfAborted();
          return previewAcpConfig(connection, cwd, settings, input.values, input.change, {
            releaseSession: (id) => this.#closeSession(connection, id),
            ...input,
            registerSession,
          });
        };
        const preview = this.codefreeRevision
          ? this.#previewCached(cwd, input, signal, load)
          : load();
        const result = await waitForAcpPreview(preview, signal);
        signal?.throwIfAborted();
        return result;
      } catch (error) {
        // 预览关闭失败或取消后释放独立设置连接，不影响项目中的聊天连接。
        await this.#closeHandle().catch(() => undefined);
        signal?.throwIfAborted();
        throw error;
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
        (id) => this.#registerBackground(id),
      );
    });
  }
  async #defaults(values?: AcpConfigValues, snapshotSignal?: AbortSignal): Promise<AcpDefaults> {
    const connection = await this.#agent(snapshotSignal);
    const validated = await readAcpDefaults(
      connection,
      this.store,
      this.engine,
      this.cwd,
      values,
      (id) => this.#closeSession(connection, id, !!snapshotSignal),
      (id) => this.#registerBackground(id),
    );
    const { defaults, migration } = validated;
    if (!snapshotSignal) await this.#discover(connection);
    // 只有用户明确提交并且协商、关闭成功后才写默认值；迁移信息留在宿主。
    if (values !== undefined)
      await this.store.update(this.engine, (latest) => ({
        ...latest,
        ...(migration ? { migration } : {}),
        values: defaults,
        configured: true,
      }));
    return projectAcpDefaults(validated);
  }
  async #discover(connection: AcpConnection, signal?: AbortSignal): Promise<void> {
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
    this.#codefreeLogin?.abort();
    // 先关闭传输以解除认证等待，再等待串行操作退场。
    await this.#closeHandle();
    await this.#queue.catch(() => undefined);
  }
  async #registerBackground(sessionId: string): Promise<void> {
    // 关闭只释放 ACP 连接上的会话。原生目录可能继续返回同一 ID，需先登记用途。
    await this.catalogStore?.catalog("acp.session.background", { engine: this.engine, sessionId });
  }
  async #closeSession(connection: AcpConnection, sessionId: string, snapshot = false) {
    // 设置服务独占连接；最小 v1 Agent 没有 close 时直接回收进程释放临时会话。
    if (!connection.canCloseSessions) {
      await this.#closeHandle(connection);
      return;
    }
    try {
      await closeAcpSettingsSession(connection, sessionId, snapshot);
    } catch (error) {
      await this.#closeHandle(connection);
      if (!snapshot) throw error;
    }
  }
  async #closeHandle(connection?: AcpConnection): Promise<void> {
    const current = this.#handle;
    // 迟到的旧会话清理不能关闭后续设置操作创建的新连接。
    if (!current || (connection && current.connection !== connection)) return;
    this.#handle = undefined;
    await closeAcpAgentHandle(current.launched);
  }
}
