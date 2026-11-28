import type { AcpProfileClient } from "./acp-fast-mode-gate.js";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import {
  modelScopedAcpOptions,
  overlayAcpConfig,
  readCachedAcpPreview,
  resetAcpModelOverrides,
  useAcpPreviewCatalog,
} from "./acp-preview-cache.js";
import { v4 as createUuid } from "uuid";
import {
  bindAcpDraft,
  type AcpDraftView,
  type AcpDraftDelivery,
} from "@codexly/frontend-core/acp-draft-binding";
import type { AcpConfigPreview, AcpConfigPreviewRequest, AgentEngine } from "@codexly/protocol";

export interface AcpDraftClient extends AcpProfileClient {
  previewAcpConfig(
    projectId: string,
    engine: AgentEngine,
    input: AcpConfigPreviewRequest,
    options: { signal: AbortSignal },
  ): Promise<AcpConfigPreview>;
}

const pendingView: AcpDraftView = {
  preview: undefined,
  isPending: true,
  isSaving: false,
  hasSubmission: false,
  canSubmit: false,
  error: null,
};
const storage = {
  read(key: string): unknown {
    try {
      const value = sessionStorage.getItem(key) ?? "null";
      if (value.length > 2 * 1024 * 1024) return { invalid: true };
      return JSON.parse(value) as unknown;
    } catch {
      return { invalid: true };
    }
  },
  write(key: string, value: unknown) {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  },
};

/** 草稿记录使用独立 sessionStorage 键；不扩展旧草稿、全局配置或原生偏好文件。 */
export function useAcpDraft({
  projectId,
  engine,
  workspace,
  draftId,
  enabled = true,
  allowDefaultSubmit = false,
}: Readonly<{
  projectId: string;
  engine: AgentEngine;
  workspace: string;
  draftId?: string;
  enabled?: boolean;
  allowDefaultSubmit?: boolean;
}>) {
  const catalog = useAcpPreviewCatalog();
  const queryCache = useContext(QueryClientContext);
  const cached = catalog[engine];
  const storageKey = `codexly:acp-draft:v1:${JSON.stringify([projectId, draftId ?? "draft"])}`;
  const scope = useMemo(
    () => ({ binding: undefined as ReturnType<typeof bindAcpDraft> | undefined }),
    [projectId, engine, workspace, storageKey, enabled, allowDefaultSubmit],
  );
  const [state, setState] = useState<{ scope: object; view: AcpDraftView }>();
  useEffect(() => {
    if (!enabled) return;
    const binding = bindAcpDraft({
      identity: JSON.stringify([engine, workspace]),
      restored: storage.read(storageKey),
      allowDefaultSubmit,
      useOverrides: true,
      preview: ({ values, change }) => {
        const known = readCachedAcpPreview(queryCache, engine);
        return Promise.resolve({
          configOptions: [],
          // 快照只负责展示。真正提交时仅发送用户主动修改的值。
          values: change
            ? {
                ...resetAcpModelOverrides(
                  known?.configOptions ?? [],
                  known,
                  values,
                  change.configId,
                  change.value,
                ),
                [change.configId]: change.value,
              }
            : values,
        });
      },
      save: (value) => {
        storage.write(storageKey, value);
      },
      createKey: createUuid,
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
  }, [scope, projectId, engine, workspace, storageKey, enabled, allowDefaultSubmit, queryCache]);
  const setConfig = useCallback(
    (id: string, value: string | boolean) =>
      scope.binding?.setConfig(id, value) ?? Promise.resolve(false),
    [scope],
  );
  const submit = useCallback(
    <T,>(
      request: unknown,
      key: string,
      execute: (delivery: AcpDraftDelivery) => Promise<T>,
    ): Promise<T> => {
      if (!scope.binding) return Promise.reject(new Error("ACP 草稿配置尚不可用于发送"));
      return scope.binding.submit(request, key, execute);
    },
    [scope],
  );
  const canChangeScope = useCallback(() => {
    const current = scope.binding?.getSnapshot();
    return current !== undefined && !current.isSaving && !current.hasSubmission;
  }, [scope]);
  const reload = useCallback(() => scope.binding?.reload() ?? Promise.resolve(false), [scope]);
  const current = state?.scope === scope ? state.view : pendingView;
  const values = current.preview?.values;
  const preview = useMemo(
    () => ({
      ...cached,
      values: values ?? {},
      configOptions: overlayAcpConfig(
        modelScopedAcpOptions(cached?.configOptions ?? [], cached, values ?? {}),
        values ?? {},
      ),
    }),
    [cached, values],
  );
  return {
    ...current,
    catalog,
    preview,
    setConfig,
    submit,
    canChangeScope,
    reload,
  };
}
