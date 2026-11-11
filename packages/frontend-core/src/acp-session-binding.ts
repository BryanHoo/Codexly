import type { AcpConfigOption, AcpSessionState } from "@codexly/protocol";
import { AcpSessionStateController } from "./acp-session-state.js";

/** 仅消费任务元数据，不读取正文，也不依赖平台 Store 实现。 */
export interface AcpSessionSource {
  getState: () => Readonly<{
    projectId: string;
    taskId: string;
    snapshotMetadata: Readonly<{ acpSession?: AcpSessionState }> | null;
  }>;
  subscribe: (listener: () => void) => () => void;
}
export interface AcpSessionView {
  readonly session: AcpSessionState | undefined;
  readonly isPending: boolean;
  readonly isSaving: boolean;
  readonly error: Error | null;
}

export function bindAcpSessionState(
  input: Readonly<{
    projectId: string;
    taskId: string;
    source?: AcpSessionSource;
    read: (signal: AbortSignal) => Promise<AcpSessionState>;
    write: (
      id: string,
      value: string | boolean,
      signal: AbortSignal,
    ) => Promise<readonly AcpConfigOption[]>;
    onChange: (view: AcpSessionView) => void;
  }>,
) {
  const controller = new AcpSessionStateController();
  const abort = new AbortController();
  let closed = false;
  const isActive = () => !closed;
  let previous: AcpSessionState | undefined;
  let view: AcpSessionView = { session: undefined, isPending: true, isSaving: false, error: null };
  const update = (patch: Partial<AcpSessionView>) => {
    if (closed) return;
    const next = { ...view, ...patch };
    if (
      next.session === view.session &&
      next.isPending === view.isPending &&
      next.isSaving === view.isSaving &&
      next.error === view.error
    )
      return;
    view = next;
    input.onChange(view);
  };
  const unsubscribeController = controller.subscribe(() => {
    update({ session: controller.getSnapshot(), isPending: false, error: null });
  });
  const receiveSource = () => {
    const state = input.source?.getState();
    if (state?.projectId !== input.projectId || state.taskId !== input.taskId) return;
    const session = state.snapshotMetadata?.acpSession;
    // Store 的 token 通知共享同一配置引用；仅新权威状态使旧请求令牌失效。
    if (session !== undefined && session !== previous) {
      previous = session;
      controller.receive(session);
    }
  };
  const unsubscribeSource = input.source?.subscribe(receiveSource);
  receiveSource();
  if (controller.getSnapshot() === undefined) {
    const token = controller.capture();
    void (async () => {
      try {
        controller.commitRead(token, await input.read(abort.signal));
      } catch (error) {
        // 已有事件接管时，旧读取失败不能覆盖可用配置。
        if (isActive() && controller.getSnapshot() === undefined) {
          update({ error: asError(error) });
        }
      } finally {
        update({ isPending: false });
      }
    })();
  }
  return {
    getSnapshot: () => view,
    async runConfigured<T>(execute: () => Promise<T>): Promise<T> {
      // 配置和发送共用同步锁；键盘事件不能抢在 React 的禁用状态更新之前提交。
      if (closed || view.isPending || view.isSaving || view.error || !view.session)
        throw new Error("ACP 会话配置尚不可用于发送");
      update({ isSaving: true });
      try {
        return await execute();
      } finally {
        update({ isSaving: false });
      }
    },
    async setConfig(id: string, value: string | boolean): Promise<boolean> {
      if (closed || view.isSaving || controller.getSnapshot() === undefined) return false;
      update({ isSaving: true, error: null });
      const token = controller.capture();
      try {
        const config = await input.write(id, value, abort.signal);
        if (!isActive()) return false;
        controller.commitConfiguration(token, config);
        return true;
      } catch (error) {
        update({ error: asError(error) });
        return false;
      } finally {
        update({ isSaving: false });
      }
    },
    dispose() {
      if (closed) return;
      closed = true;
      unsubscribeSource?.();
      unsubscribeController();
      controller.dispose();
      abort.abort();
    },
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
