import { useEffect, useMemo, useState } from "react";
import type { AcpProfileClient } from "./acp-fast-mode-gate.js";
import { useAcpDraft } from "./use-acp-draft.js";
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
import type { AcpConfigValues, AgentEngine } from "@codexly/protocol";

const defaultEngines: readonly AgentEngine[] = ["codex", "claude"];
/** 两端共用引擎选择与原始草稿配置，从应用启动缓存展示选项。 */
export function useAcpDraftComposer(
  input: Readonly<{
    client?: AcpProfileClient;
    projectId: string;
    workspace: string;
    draftId?: string;
    initialEngine?: AgentEngine;
    planConfig?: Readonly<{ engine?: AgentEngine; values: AcpConfigValues }>;
    configurationLabel: string;
    engineLabel: string;
    retryLabel: string;
    language?: string;
  }>,
) {
  const enabledEngines = useSelectedEngines() ?? defaultEngines;
  const savedEngine = input.planConfig?.engine;
  // 已保存计划回显原 Agent，目录变化不能改写计划执行身份。
  const engines = useMemo(
    () =>
      savedEngine && !enabledEngines.includes(savedEngine)
        ? [...enabledEngines, savedEngine]
        : enabledEngines,
    [enabledEngines, savedEngine],
  );
  const scope = JSON.stringify([input.projectId, input.draftId ?? "draft"]);
  const inherited = useMemo(
    () =>
      input.initialEngine ??
      (input.planConfig
        ? defaultAcpDraftEngine(engines)
        : readAcpDraftEngine(browserSetupStorage, scope, engines)),
    [scope, engines, input.initialEngine, input.planConfig],
  );
  const [selection, setSelection] = useState<{
    scope: string;
    engine: AgentEngine;
    model?: { id: string; value: string; workspace: string };
  }>(() => ({ scope, engine: inherited }));
  const selected = selection.scope === scope ? selection.engine : inherited;
  const engine = engines.includes(selected) ? selected : defaultAcpDraftEngine(engines);
  const draft = useAcpDraft({
    ...input,
    engine,
    enabled: engines.length > 0,
    allowDefaultSubmit: !input.planConfig,
  });
  const requested =
    selection.scope === scope &&
    selection.engine === engine &&
    selection.model?.workspace === input.workspace
      ? selection.model
      : undefined;
  // 切换 Agent 时把模型选择交给新草稿。实际会话会在发送时应用选项。
  useEffect(() => {
    if (!requested || draft.isPending || draft.isSaving) return;
    setSelection((current) => (current === selection ? { scope, engine } : current));
    void draft.setConfig(requested.id, requested.value);
  }, [selection, requested, scope, engine, draft.isPending, draft.isSaving, draft.setConfig]);
  const modelOptions = draft.preview.configOptions;
  const disabled = draft.isPending || draft.isSaving || engines.length === 0;
  const selectEngine = (next: AgentEngine, model?: { id: string; value: string }) => {
    if (!draft.canChangeScope() || !engines.includes(next)) return;
    if (!input.planConfig) saveAcpDraftEngine(browserSetupStorage, scope, next);
    setSelection({
      scope,
      engine: next,
      ...(model ? { model: { ...model, workspace: input.workspace } } : {}),
    });
  };
  const common = {
    engine,
    client: input.client,
    options: draft.preview.configOptions,
    disabled,
    error: draft.error,
    ...(input.language ? { language: input.language } : {}),
    retry: {
      label: input.retryLabel,
      run: () => {
        void draft.reload();
      },
    },
  };
  return {
    ...draft,
    engine,
    isBusy: !draft.canSubmit || engines.length === 0 || requested !== undefined,
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
        disabled={disabled}
        engines={engines}
        locked={draft.hasSubmission}
        catalog={draft.catalog}
        selectDefaultEngine={selectEngine}
        onSelect={(next, id, value) => {
          if (next === engine) {
            void draft.setConfig(id, value);
            return;
          }
          selectEngine(next, { id, value });
        }}
      />
    ),
  };
}
