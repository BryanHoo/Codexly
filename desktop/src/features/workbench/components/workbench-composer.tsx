import { useSelectedEngines } from "@codexly/ui/core/engine-selection";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NativeClient } from "@/platform/native-client-contract.js";
import type { AgentEngine, AgentTaskSettings } from "@codexly/protocol";
import { resolveClaudeComposerSettings, resolveCodexComposerSettings } from "@codexly/frontend-core/engine-composer";
import { AgentEngineSelector } from "@codexly/ui/core/agent-engine-controls";
import { useEngineComposerState } from "@codexly/ui/core/engine-composer-state";
import { useTranslation } from "../../../i18n/i18n.js";
import { providerConnectionQueryOptions } from "../../provider-connection/provider-connection-queries.js";
import { WorkbenchComposerBase } from "./workbench-composer-base.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
export * from "./workbench-composer-contracts.js";
export * from "../composer-state.js";

type EngineClient = Pick<NativeClient, "getEngineProfile" | "configureEngine" | "updateTaskSettings">;
const emptyModels = [] as const;

export function WorkbenchComposer(props: WorkbenchComposerProps) {
  const { t } = useTranslation("workbench");
  const codexEnabled = useSelectedEngines()?.includes("codex") ?? true;
  const connection = useQuery({ ...providerConnectionQueryOptions(), enabled: codexEnabled });
  const client = props.client as WorkbenchComposerProps["client"] & Partial<EngineClient>;
  const scope = JSON.stringify([props.projectId, props.composerDraftId ?? props.taskId ?? (props.onCaptureSubmission ? "capture" : "draft")]);
  const load = useCallback((engine: AgentEngine) => {
    if (import.meta.env.VITE_MACOS_LEGACY === "true") return Promise.reject(new Error(t("engine.unsupportedLegacy")));
    if (!client.getEngineProfile) return Promise.reject(new Error("Engine service unavailable"));
    return client.getEngineProfile(engine, props.projectId);
  }, [client, props.projectId, t]);
  const state = useEngineComposerState({ scope, taskId: props.taskId, taskEngine: props.runtime?.metadata?.engine,
    ...(props.initialEngine === undefined ? {} : { initialEngine: props.initialEngine }), codexConfigured: connection.isPending ? undefined : connection.data?.state === "connected", claudeSupported: import.meta.env.VITE_MACOS_LEGACY !== "true", load });
  const [override, setOverride] = useState<{ scope: string; settings: AgentTaskSettings } | undefined>(() =>
    props.onCaptureSubmission && props.settings.engineOptions?.engine === "claude"
      ? { scope, settings: props.settings }
      : undefined,
  );
  const claude = state.engine === "claude";
  const models = state.pending ? emptyModels : claude ? state.profile?.models.data ?? emptyModels : props.models;
  const settings = claude ? resolveClaudeComposerSettings(override?.scope === scope ? override.settings : props.settings, models, state.profile?.settings) : resolveCodexComposerSettings(props.settings, props.models);
  const controls = <>
    <AgentEngineSelector codexAvailable={state.codexConfigured} claudeAvailable={state.claudeConfigured} label={t("engine.select")} value={state.engine} locked={state.locked} disabled={state.submitting} onChange={state.select} />
  </>;
  return <WorkbenchComposerBase {...props}
    engineControls={controls}
    {...(claude ? { engineCommands: state.profile?.commands ?? [] } : {})}
    models={models} modelsPending={state.pending || (!claude && props.modelsPending)} modelsError={claude ? state.error ?? null : props.modelsError}
    capabilities={claude ? state.profile?.capabilities : props.capabilities}
    settings={settings} skills={claude ? [] : props.skills}
    fastModeAvailable={!claude && props.fastModeAvailable}
    followUpBehavior={claude ? "steer" : props.followUpBehavior}
    onSubmissionStateChange={(submitting) => { state.setSubmitting(submitting); props.onSubmissionStateChange?.(submitting); }}
    onSettingsChange={async (next, field, fastMode) => {
      if (!claude) return props.onSettingsChange(next, field, fastMode);
      if (props.taskId && client.updateTaskSettings) await client.updateTaskSettings(props.projectId, props.taskId, next);
      setOverride({ scope, settings: next });
    }}
  />;
}
