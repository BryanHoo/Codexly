import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bindAcpSessionState,
  type AcpSessionSource,
  type AcpSessionView,
} from "@codexly/frontend-core/acp-session-binding";
import type { AcpConfigOption, AcpSessionState } from "@codexly/protocol";

/** HTTP 与原生客户端均满足此端口；Hook 不导入任何平台传输。 */
export interface AcpSessionClient {
  getAcpSessionState: (
    projectId: string,
    taskId: string,
    options: { signal: AbortSignal },
  ) => Promise<AcpSessionState>;
  setAcpSessionConfig: (
    projectId: string,
    taskId: string,
    id: string,
    value: string | boolean,
    options: { signal: AbortSignal },
  ) => Promise<readonly AcpConfigOption[]>;
}
const pendingView: AcpSessionView = {
  session: undefined,
  isPending: true,
  isSaving: false,
  error: null,
};

export function useAcpSession({
  client,
  projectId,
  taskId,
  source,
}: Readonly<{
  client: AcpSessionClient;
  projectId: string;
  taskId: string;
  source?: AcpSessionSource;
}>) {
  const scope = useMemo(
    () => ({
      binding: undefined as ReturnType<typeof bindAcpSessionState> | undefined,
    }),
    [client, projectId, taskId, source],
  );
  const [state, setState] = useState<{ scope: object; view: AcpSessionView }>();
  useEffect(() => {
    // 在 effect 内创建绑定，StrictMode 的清理与重挂载不会复用已关闭的控制器。
    const binding = bindAcpSessionState({
      projectId,
      taskId,
      ...(source === undefined ? {} : { source }),
      read: (signal) => client.getAcpSessionState(projectId, taskId, { signal }),
      write: (id, value, signal) =>
        client.setAcpSessionConfig(projectId, taskId, id, value, { signal }),
      onChange: (view) => {
        setState({ scope, view });
      },
    });
    scope.binding = binding;
    setState({ scope, view: binding.getSnapshot() });
    return () => {
      scope.binding = undefined;
      binding.dispose();
    };
  }, [client, projectId, taskId, source, scope]);
  const setConfig = useCallback(
    (id: string, value: string | boolean) =>
      scope.binding?.setConfig(id, value) ?? Promise.resolve(false),
    [scope],
  );
  const runConfigured = useCallback(
    <T,>(execute: () => Promise<T>): Promise<T> => {
      if (!scope.binding) return Promise.reject(new Error("ACP 会话配置尚不可用于发送"));
      return scope.binding.runConfigured(execute);
    },
    [scope],
  );
  // 切换后的首帧即隔离旧任务，不能等待 effect 清理再隐藏旧值。
  return { ...(state?.scope === scope ? state.view : pendingView), setConfig, runConfigured };
}
