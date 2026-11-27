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
import type { AgentEngine } from "@codexly/protocol";

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
    model?: { id: string; value: string };
  }>(() => ({ scope, engine: inherited }));
  const selected = selection.scope === scope ? selection.engine : inherited;
  const engine = engines.includes(selected) ? selected : defaultAcpDraftEngine(engines);
  const draft = useAcpDraft({ ...input, engine, enabled: engines.length > 0 });
  // 跨 Agent 选择先切换草稿归属，等待该引擎协商完成后再提交原始模型值。
  // 每个选择只消费一次；旧 binding 的取消和结果隔离仍由 useAcpDraft 负责。
  useEffect(() => {
    if (
      selection.scope !== scope ||
      selection.engine !== engine ||
      !selection.model ||
      !draft.preview ||
      draft.isPending ||
      draft.isSaving
    )
      return;
    const requested = selection.model;
    setSelection((current) => (current === selection ? { scope, engine } : current));
    void draft.setConfig(requested.id, requested.value);
  }, [selection, scope, engine, draft.preview, draft.isPending, draft.isSaving, draft.setConfig]);
  const loadOptions = useAcpModelOptions(input.client, input.projectId, input.workspace);
  const disabled = draft.isPending || draft.isSaving || engines.length === 0;
  const common = {
    engine,
    client: input.client,
    options: draft.preview?.configOptions ?? [],
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
    isBusy:
      disabled ||
      draft.error !== null ||
      (selection.scope === scope && selection.engine === engine && selection.model !== undefined),
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
        engines={engines}
        locked={draft.hasSubmission}
        loadingCurrent={draft.isPending && !draft.isSaving && !draft.hasSubmission}
        loadOptions={loadOptions}
        onSelect={(next, id, value) => {
          if (next === engine) {
            void draft.setConfig(id, value);
            return;
          }
          if (!draft.canChangeScope() || !engines.includes(next)) return;
          saveAcpDraftEngine(browserSetupStorage, scope, next);
          setSelection({ scope, engine: next, model: { id, value } });
        }}
      />
    ),
  };
}
