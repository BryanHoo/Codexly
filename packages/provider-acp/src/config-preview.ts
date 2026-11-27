import { createHash } from "node:crypto";
import type { AcpConfigPreview, AcpConfigValues, AcpConfigPreviewRequest } from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";
import type { AcpStoredSettings } from "./settings-store.js";
import { applyAcpConfig, prepareAcpDefaults } from "./configuration.js";

/** 只缓存 Agent 已确认的默认预览。显式选项变更仍由真实会话重新校验。 */
export class AcpPreviewCache {
  readonly #entries = new Map<string, { result: AcpConfigPreview; expires: number }>();
  readonly #pending = new Map<string, Promise<AcpConfigPreview>>();

  async read(
    cwd: string,
    revision: string,
    saved: AcpStoredSettings,
    input: AcpConfigPreviewRequest,
    load: () => Promise<AcpConfigPreview>,
  ): Promise<AcpConfigPreview> {
    if (input.change || Object.keys(input.values).length) return load();
    const key = createHash("sha256")
      .update(JSON.stringify([cwd, revision, saved, input.includeCommands === true]))
      .digest("hex");
    const cached = this.#entries.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const pending = this.#pending.get(key);
    if (pending) return pending;
    const loading = load();
    if (this.#pending.size < 12) this.#pending.set(key, loading);
    try {
      const result = await loading;
      this.#entries.delete(key);
      this.#entries.set(key, { result, expires: Date.now() + 120_000 });
      if (this.#entries.size > 12) {
        const first = this.#entries.keys().next().value;
        if (first) this.#entries.delete(first);
      }
      return result;
    } finally {
      if (this.#pending.get(key) === loading) this.#pending.delete(key);
    }
  }
}

/** 设置和授权版本在读取前固定，避免把不同认证状态的结果写入同一预览条目。 */
export function createAcpPreviewReader(
  readSettings: () => Promise<AcpStoredSettings>,
  readRevision?: () => Promise<string | undefined>,
) {
  const cache = new AcpPreviewCache();
  return async (
    cwd: string,
    input: AcpConfigPreviewRequest,
    signal: AbortSignal | undefined,
    load: (saved: AcpStoredSettings, revision?: string) => Promise<AcpConfigPreview>,
  ) => {
    signal?.throwIfAborted();
    const [saved, revision] = await Promise.all([readSettings(), readRevision?.()]);
    signal?.throwIfAborted();
    const result = revision
      ? await cache.read(cwd, revision, saved, input, () => load(saved, revision))
      : await load(saved);
    signal?.throwIfAborted();
    return result;
  };
}

/** 视图离开后停止等待，已借出的项目会话继续走自己的关闭流程。 */
export async function waitForAcpPreview<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  const cancelled = Promise.withResolvers<never>();
  const abort = () => {
    cancelled.reject(signal.reason);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    return await Promise.race([promise, cancelled.promise]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** 草稿协商只借用配置快照，不接收仓储写入或应用任务创建端口。 */
export async function previewAcpConfig(
  connection: AcpConnection,
  cwd: string,
  saved: AcpStoredSettings,
  values: AcpConfigValues,
  change?: AcpConfigPreviewRequest["change"],
  options?: {
    registerSession?: (id: string) => Promise<void>;
    releaseSession?: (id: string) => Promise<void>;
    includeCommands?: boolean;
  },
) {
  const session = await connection.newSession({ cwd, mcpServers: [] });
  try {
    await options?.registerSession?.(session.sessionId);
    // 先恢复仍有效的默认值；草稿显式选择严格校验，不写全局默认设置。
    const current = await prepareAcpDefaults(
      connection,
      session.sessionId,
      session.configOptions,
      saved,
      undefined,
      true,
    );
    let configOptions = await applyAcpConfig(
      connection,
      session.sessionId,
      current.configOptions,
      values,
      change ? [] : undefined,
    );
    if (change)
      configOptions = await applyAcpConfig(connection, session.sessionId, configOptions, {
        [change.configId]: change.value,
      });
    const availableCommands = options?.includeCommands
      ? await connection.readPreviewCommands(session.sessionId)
      : undefined;
    return {
      configOptions,
      values: Object.fromEntries(configOptions.map((option) => [option.id, option.currentValue])),
      ...(availableCommands === undefined ? {} : { availableCommands }),
    };
  } finally {
    // 关闭失败必须向上报告，不能把泄漏的会话当作成功预览。
    if (options?.releaseSession) await options.releaseSession(session.sessionId);
    else await connection.closeSession(session.sessionId);
  }
}
