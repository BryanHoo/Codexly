import { useMemo, useState } from "react";
import { useAcpDraft, type AcpDraftClient } from "./use-acp-draft.js";
import { browserSetupStorage, useSelectedEngines } from "./engine-selection.js";
import { readAcpDraftEngine, saveAcpDraftEngine } from "@codexly/frontend-core/acp-draft-engine";
import { AgentEngineSelector } from "./agent-engine-controls.js";
import { AcpComposerConfiguration } from "./acp-composer-configuration.js";
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
  }>,
) {
  const engines = useSelectedEngines() ?? defaultEngines;
  const scope = JSON.stringify([input.projectId, input.draftId ?? "draft"]);
  const inherited = useMemo(
    () => input.initialEngine ?? readAcpDraftEngine(browserSetupStorage, scope, engines),
    [scope, engines, input.initialEngine],
  );
  const [selection, setSelection] = useState(() => ({ scope, engine: inherited }));
  const selected = selection.scope === scope ? selection.engine : inherited;
  const engine = engines.includes(selected) ? selected : (engines[0] ?? "codex");
  const draft = useAcpDraft({ ...input, engine, enabled: engines.length > 0 });
  return {
    ...draft,
    engine,
    isBusy: engines.length === 0 || draft.isPending || draft.isSaving || draft.error !== null,
    controls: (
      <>
        {engines.length > 1 ? (
          <AgentEngineSelector
            label={input.engineLabel}
            value={engine}
            codexAvailable={engines.includes("codex")}
            claudeAvailable={engines.includes("claude")}
            locked={draft.hasSubmission}
            disabled={draft.isSaving}
            onChange={(next) => {
              if (!draft.canChangeScope()) return;
              saveAcpDraftEngine(browserSetupStorage, scope, next);
              setSelection({ scope, engine: next });
            }}
          />
        ) : null}
        <AcpComposerConfiguration
          options={draft.preview?.configOptions ?? []}
          disabled={draft.isPending || draft.isSaving || engines.length === 0}
          error={draft.error}
          label={input.configurationLabel}
          retry={{
            label: input.retryLabel,
            run: () => {
              void draft.reload();
            },
          }}
          onChange={(id, value) => {
            void draft.setConfig(id, value);
          }}
        />
      </>
    ),
  };
}
