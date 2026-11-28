import {
  modelScopedAcpOptions,
  overlayAcpConfig,
  readCachedAcpPreview,
  rememberAcpModelOptions,
  resetAcpModelOverrides,
  useAcpPreviewCatalog,
} from "./acp-preview-cache.js";
import { QueryClientContext } from "@tanstack/react-query";
import type { AcpProfileClient } from "./acp-fast-mode-gate.js";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  bindAcpSessionState,
  type AcpSessionSource,
  type AcpSessionView,
} from "@codexly/frontend-core/acp-session-binding";
import type {
  AcpBackgroundTarget,
  AcpConfigOption,
  AcpConfigValues,
  AcpSessionState,
  AgentEngine,
} from "@codexly/protocol";

/** HTTP 与原生客户端均满足此端口；Hook 不导入任何平台传输。 */
export interface AcpSessionClient extends AcpProfileClient {
  cancelAcpBackground?: (
    projectId: string,
    taskId: string,
    target: AcpBackgroundTarget,
  ) => Promise<unknown>;
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
  engine,
  projectId,
  taskId,
  source,
  deferConfiguration = false,
}: Readonly<{
  client: AcpSessionClient;
  engine: AgentEngine;
  projectId: string;
  taskId: string;
  source?: AcpSessionSource;
  deferConfiguration?: boolean;
}>) {
  const queryCache = useContext(QueryClientContext);
  const scope = useMemo(
    () => ({
      binding: undefined as ReturnType<typeof bindAcpSessionState> | undefined,
    }),
    [client, engine, projectId, taskId, source, deferConfiguration],
  );
  const [state, setState] = useState<{ scope: object; view: AcpSessionView }>();
  useEffect(() => {
    // 在 effect 内创建绑定，StrictMode 的清理与重挂载不会复用已关闭的控制器。
    const binding = bindAcpSessionState({
      projectId,
      taskId,
      deferConfiguration,
      prepareOverrides: (view, id, value) => {
        const cached = readCachedAcpPreview(queryCache, engine);
        const options = view.session?.configOptions ?? cached?.configOptions ?? [];
        return resetAcpModelOverrides(
          modelScopedAcpOptions(options, cached, view.displayedOverrides ?? {}),
          cached,
          view.overrides ?? {},
          id,
          value,
        );
      },
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
  }, [client, engine, projectId, taskId, source, scope, deferConfiguration, queryCache]);
  const setConfig = useCallback(
    (id: string, value: string | boolean) =>
      scope.binding?.setConfig(id, value) ?? Promise.resolve(false),
    [scope],
  );
  const runConfigured = useCallback(
    <T,>(execute: (overrides?: AcpConfigValues) => Promise<T>): Promise<T> => {
      if (!scope.binding) return Promise.reject(new Error("ACP 会话配置尚不可用于发送"));
      return scope.binding.runConfigured(execute);
    },
    [scope],
  );
  // 切换后的首帧即隔离旧任务，不能等待 effect 清理再隐藏旧值。
  return { ...(state?.scope === scope ? state.view : pendingView), setConfig, runConfigured };
}

/** 已有聊天先使用会话事件；启动阶段尚无事件时用 Agent 缓存填充控件。 */
export function useAcpSessionConfigOptions(engine: AgentEngine, view: AcpSessionView) {
  const catalog = useAcpPreviewCatalog();
  const cache = useContext(QueryClientContext);
  const cached = catalog[engine];
  const live = view.session?.configOptions;
  useEffect(() => {
    if (cache && live) rememberAcpModelOptions(cache, engine, live);
  }, [cache, engine, live]);
  const options = view.session?.configOptions ?? cached?.configOptions;
  return useMemo(() => {
    const values = { ...view.displayedOverrides, ...view.overrides };
    return view.overrides || view.displayedOverrides
      ? overlayAcpConfig(modelScopedAcpOptions(options ?? [], cached, values), values)
      : (options ?? []);
  }, [options, cached, view.overrides, view.displayedOverrides]);
}
