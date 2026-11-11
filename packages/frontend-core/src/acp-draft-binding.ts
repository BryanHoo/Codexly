import type { AcpConfigPreview, AcpConfigPreviewRequest, AcpConfigValues } from "@codexly/protocol";

type Attempt = Readonly<{
  key: string;
  creationKey: string;
  fingerprint: string;
  recoveryKey?: string;
}>;
type Persisted = Readonly<{
  version: 1;
  identity: string;
  values: AcpConfigValues;
  attempt?: Attempt;
}>;
export type AcpDraftView = Readonly<{
  preview: AcpConfigPreview | undefined;
  isPending: boolean;
  isSaving: boolean;
  hasSubmission: boolean;
  error: Error | null;
}>;
export type AcpDraftDelivery = Readonly<{
  values: AcpConfigValues;
  key: string;
  creationKey: string;
  recoveryKey?: string;
}>;

function restore(value: unknown): Persisted | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new Error("ACP 草稿恢复记录无效");
  const item = value as {
    version?: unknown;
    identity?: unknown;
    values?: unknown;
    attempt?: unknown;
  };
  if (
    item.version !== 1 ||
    typeof item.identity !== "string" ||
    !item.values ||
    typeof item.values !== "object" ||
    Array.isArray(item.values)
  )
    throw new Error("ACP 草稿恢复记录无效");
  if (
    Object.entries(item.values).some(
      ([id, v]) =>
        !id ||
        id.length > 256 ||
        (typeof v !== "boolean" && (typeof v !== "string" || v.length > 16384)),
    )
  )
    throw new Error("ACP 草稿配置无效");
  if (
    item.attempt !== undefined &&
    (!item.attempt || typeof item.attempt !== "object" || Array.isArray(item.attempt))
  )
    throw new Error("ACP 草稿提交身份无效");
  const attempt:
    | { key?: unknown; creationKey?: unknown; fingerprint?: unknown; recoveryKey?: unknown }
    | undefined = item.attempt;
  if (
    attempt &&
    (typeof attempt.key !== "string" ||
      !attempt.key ||
      attempt.key.length > 128 ||
      typeof attempt.creationKey !== "string" ||
      !attempt.creationKey ||
      attempt.creationKey.length > 128 ||
      typeof attempt.fingerprint !== "string" ||
      !attempt.fingerprint ||
      (attempt.recoveryKey !== undefined &&
        (typeof attempt.recoveryKey !== "string" ||
          !attempt.recoveryKey ||
          attempt.recoveryKey.length > 128)))
  )
    throw new Error("ACP 草稿提交身份无效");
  return {
    version: 1,
    identity: item.identity,
    values: item.values as AcpConfigValues,
    ...(attempt ? { attempt: attempt as Attempt } : {}),
  };
}

/** 两端共用草稿协商与提交互斥；存储、传输和随机键由交付层注入。 */
export function bindAcpDraft(
  input: Readonly<{
    identity?: string;
    restored?: unknown;
    preview: (request: AcpConfigPreviewRequest, signal: AbortSignal) => Promise<AcpConfigPreview>;
    save: (value: Persisted | undefined) => void;
    createKey: () => string;
    onChange: (view: AcpDraftView) => void;
  }>,
) {
  const abort = new AbortController();
  let closed = false;
  let canNegotiate = true;
  const isActive = () => !closed;
  let attempt: Attempt | undefined;
  let values: AcpConfigValues = {};
  const identity = input.identity ?? "";
  let view: AcpDraftView = {
    preview: undefined,
    isPending: true,
    isSaving: false,
    hasSubmission: false,
    error: null,
  };
  const update = (patch: Partial<AcpDraftView>) => {
    if (closed) return;
    view = { ...view, ...patch };
    input.onChange(view);
  };
  const persist = () => {
    const saved: Persisted = { version: 1, identity, values, ...(attempt ? { attempt } : {}) };
    // 提交身份必须在请求前保留；容量或持久化失败不能放行一次无法恢复的发送。
    if (JSON.stringify(saved).length > 2 * 1024 * 1024)
      throw new Error("ACP 草稿恢复记录超过容量限制");
    input.save(saved);
  };
  const negotiate = async (change?: AcpConfigPreviewRequest["change"]) => {
    try {
      const result = await input.preview({ values, ...(change ? { change } : {}) }, abort.signal);
      if (closed) return false;
      values = result.values;
      persist();
      update({ preview: result, error: null });
      return true;
    } catch (error) {
      update({ error: error instanceof Error ? error : new Error(String(error)) });
      return false;
    } finally {
      update({ isPending: false, isSaving: false });
    }
  };
  try {
    const restored = restore(input.restored);
    if (restored?.attempt && restored.identity !== identity)
      throw new Error("草稿已有提交，请在原引擎和工作目录中恢复，或新建独立聊天");
    if (restored?.identity === identity) {
      values = restored.values;
      attempt = restored.attempt;
      view = { ...view, hasSubmission: attempt !== undefined };
    }
    void negotiate();
  } catch (error) {
    // 身份校验失败不能通过“重试预览”清空已有提交；只允许回到原作用域恢复。
    canNegotiate = false;
    update({ isPending: false, error: error instanceof Error ? error : new Error(String(error)) });
  }
  return {
    getSnapshot: () => view,
    reload(): Promise<boolean> {
      if (closed || !canNegotiate || view.isPending || view.isSaving) return Promise.resolve(false);
      update({ isSaving: true });
      return negotiate();
    },
    async setConfig(configId: string, value: string | boolean): Promise<boolean> {
      if (closed || view.isPending || view.isSaving || !view.preview) return false;
      update({ isSaving: true });
      return negotiate({ configId, value });
    },
    async submit<T>(
      request: unknown,
      key: string,
      execute: (delivery: AcpDraftDelivery) => Promise<T>,
    ): Promise<T> {
      if (closed || view.isPending || view.isSaving || view.error || !view.preview)
        throw new Error("ACP 草稿配置尚不可用于发送");
      // 同步占用，配置事件和快捷键不能抢在 React 禁用状态提交前交叉执行。
      update({ isSaving: true });
      try {
        const fingerprint = JSON.stringify([
          request,
          Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
        ]);
        const previous = attempt;
        if (!attempt) attempt = { key, creationKey: key, fingerprint };
        else if (attempt.fingerprint !== fingerprint)
          attempt = {
            key: input.createKey(),
            creationKey: attempt.creationKey,
            fingerprint,
            recoveryKey: attempt.key,
          };
        try {
          persist();
        } catch (error) {
          attempt = previous;
          throw error;
        }
        update({ hasSubmission: true });
        const result = await execute({
          values,
          key: attempt.key,
          creationKey: attempt.creationKey,
          ...(attempt.recoveryKey ? { recoveryKey: attempt.recoveryKey } : {}),
        });
        // 正文由原输入框消费；成功后新草稿不能继承已完成的转交链。
        if (isActive()) {
          input.save(undefined);
          attempt = undefined;
          update({ hasSubmission: false });
        }
        return result;
      } finally {
        update({ isSaving: false });
      }
    },
    dispose() {
      closed = true;
      abort.abort();
    },
  };
}
