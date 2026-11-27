import { useEffect, useMemo, useState } from "react";
import { useAcpDraft, useAcpModelOptions, type AcpDraftClient } from "./use-acp-draft.js";
import { browserSetupStorage, useSelectedEngines } from "./engine-selection.js";
import {
  defaultAcpDraftEngine,
  readAcpDraftEngine,
  saveAcpDraftEngine,
} from "@codexly/frontend-core/acp-draft-engine";
import {
  AcpModelSelector,
  AcpComposerLeading,
  AcpComposerReasoning,
} from "./acp-model-selector.js";
import type { AcpConfigOption, AgentEngine } from "@codexly/protocol";

const defaultEngines: readonly AgentEngine[] = ["codex", "claude"];
/** 两端共用引擎选择与原始草稿配置，只协商当前选中的 agent。 */
export function useAcpDraftComposer(
  input: Readonly<{
    client: AcpDraftClient;
    projectId: string;
    workspace: string;
    draftId?: string;
    initialEngine?: AgentEngine;
    configurationLabel: string;
    engineLabel: string;
    retryLabel: string;
    language?: string;
  }>,
) {
  const engines = useSelectedEngines() ?? defaultEngines;
  const scope = JSON.stringify([input.projectId, input.draftId ?? "draft"]);
  const inherited = useMemo(
    () => input.initialEngine ?? readAcpDraftEngine(browserSetupStorage, scope, engines),
    [scope, engines, input.initialEngine],
  );
  const [selection, setSelection] = useState<{
    scope: string;
    engine: AgentEngine;
    model?: { id: string; value: string; workspace: string };
  }>(() => ({ scope, engine: inherited }));
  const selected = selection.scope === scope ? selection.engine : inherited;
  const engine = engines.includes(selected) ? selected : defaultAcpDraftEngine(engines);
  const draft = useAcpDraft({ ...input, engine, enabled: engines.length > 0 });
  const requested =
    selection.scope === scope &&
    selection.engine === engine &&
    selection.model?.workspace === input.workspace
      ? selection.model
      : undefined;
  // 冷启动期间暂存模型选择，真实会话就绪后校验。切换工作目录时忽略旧目录的选择。
  useEffect(() => {
    if (!requested || !draft.preview || draft.isPending || draft.isSaving) return;
    setSelection((current) => (current === selection ? { scope, engine } : current));
    void draft.setConfig(requested.id, requested.value);
  }, [
    selection,
    requested,
    scope,
    engine,
    draft.preview,
    draft.isPending,
    draft.isSaving,
    draft.setConfig,
  ]);
  const loadOptions = useAcpModelOptions(input.client, input.projectId, input.workspace);
  const [catalog, setCatalog] = useState<{
    load: typeof loadOptions;
    options: readonly AcpConfigOption[];
  }>();
  const useNativeCatalog = engine === "acp-codefree-o" && !draft.preview && !draft.hasSubmission;
  const [catalogAttempt, retryCatalog] = useState(0);
  useEffect(() => {
    if (!useNativeCatalog) return;
    // 模型目录独立于会话预热。预热失败时继续读取，直到切换工作区或得到 ACP 配置。
    const controller = new AbortController();
    void loadOptions(engine, controller.signal).then(
      (options) => {
        if (!controller.signal.aborted) setCatalog({ load: loadOptions, options });
      },
      () => undefined,
    );
    return () => {
      controller.abort();
    };
  }, [engine, useNativeCatalog, loadOptions, catalogAttempt]);
  const earlyOptions =
    useNativeCatalog && catalog?.load === loadOptions && catalog.options.length
      ? catalog.options
      : undefined;
  const modelOptions = earlyOptions ?? draft.preview?.configOptions ?? [];
  const disabled = draft.isPending || draft.isSaving || engines.length === 0;
  const chinese = (input.language ?? "zh-CN") === "zh-CN";
  const error = useMemo(() => {
    if (engine !== "acp-codefree-o") return draft.error;
    if (draft.error?.message === "ACP_AUTH_REQUIRED")
      return new Error(
        chinese
          ? "请在「配置 Agent」中登录 CodeFree O，再重试。"
          : "Sign in to CodeFree O in Configure agents, then try again.",
      );
    if (draft.error?.message === "ACP_HOST_REQUEST_FAILED")
      return new Error(
        chinese
          ? "CodeFree O 会话准备失败，请重试。"
          : "Could not prepare the CodeFree O session. Try again.",
      );
    return draft.error;
  }, [engine, draft.error, chinese]);
  const common = {
    engine,
    client: input.client,
    options: draft.preview?.configOptions ?? [],
    disabled,
    error,
    ...(input.language ? { language: input.language } : {}),
    retry: {
      label: input.retryLabel,
      run: () => {
        if (useNativeCatalog && !earlyOptions) retryCatalog((attempt) => attempt + 1);
        void draft.reload();
      },
    },
  };
  return {
    ...draft,
    engine,
    isBusy: disabled || draft.error !== null || requested !== undefined,
    trailingControls: (
      <AcpComposerReasoning
        {...common}
        label={input.configurationLabel}
        onChange={(id, value) => {
          void draft.setConfig(id, value);
        }}
      />
    ),
    leadingControls: (
      <AcpComposerLeading
        {...common}
        label={input.configurationLabel}
        onChange={(id, value) => {
          void draft.setConfig(id, value);
        }}
      />
    ),
    controls: (
      <AcpModelSelector
        {...common}
        engine={engine}
        options={
          requested
            ? modelOptions.map((option) =>
                option.type === "select" && option.id === requested.id
                  ? { ...option, currentValue: requested.value }
                  : option,
              )
            : modelOptions
        }
        disabled={earlyOptions ? draft.isSaving : disabled}
        engines={engines}
        locked={draft.hasSubmission}
        loadingCurrent={!earlyOptions && draft.isPending && !draft.isSaving && !draft.hasSubmission}
        loadOptions={loadOptions}
        onSelect={(next, id, value) => {
          if (next === engine && !useNativeCatalog) {
            void draft.setConfig(id, value);
            return;
          }
          if (!draft.canChangeScope() || !engines.includes(next)) return;
          saveAcpDraftEngine(browserSetupStorage, scope, next);
          setSelection({ scope, engine: next, model: { id, value, workspace: input.workspace } });
        }}
      />
    ),
  };
}
