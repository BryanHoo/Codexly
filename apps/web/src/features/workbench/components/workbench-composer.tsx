import { engineProfileQuery } from "@codexly/frontend-core/engine-settings-query";
import { useSelectedEngines } from "@codexly/ui/core/engine-selection";
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CodexlyClient } from "@codexly/client";
import type { AgentEngine, AgentTaskSettings } from "@codexly/protocol";
import {
  resolveClaudeComposerSettings,
  resolveCodexComposerSettings,
} from "@codexly/frontend-core/engine-composer";
import { AgentEngineSelector } from "@codexly/ui/core/agent-engine-controls";
import { useEngineComposerState } from "@codexly/ui/core/engine-composer-state";
import { useTranslation } from "../../../i18n/i18n.js";
import { providerConnectionQueryOptions } from "../../provider-connection/provider-connection-queries.js";
import { WorkbenchComposerBase } from "./workbench-composer-base.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
export * from "./workbench-composer-contracts.js";
export * from "../composer-state.js";

type EngineClient = Pick<
  CodexlyClient,
  "getEngineProfile" | "configureEngine" | "updateTaskSettings"
>;
const emptyModels = [] as const;

export function WorkbenchComposer(props: WorkbenchComposerProps) {
  const { t } = useTranslation("workbench");
  const queryClient = useQueryClient();
  const codexEnabled = useSelectedEngines()?.includes("codex") ?? true;
  const connection = useQuery({ ...providerConnectionQueryOptions(), enabled: codexEnabled });
  const client = props.client as WorkbenchComposerProps["client"] & Partial<EngineClient>;
  const scope = JSON.stringify([
    props.projectId,
    props.composerDraftId ?? props.taskId ?? (props.onCaptureSubmission ? "capture" : "draft"),
  ]);
  const profileQueryKey = ["engine-profile", "claude", props.projectId] as const;
  const readProfile = useCallback(
    (engine: AgentEngine) => {
      const getProfile = client.getEngineProfile?.bind(client);
      if (!getProfile) return Promise.reject(new Error("Engine service unavailable"));
      return getProfile(engine, props.projectId);
    },
    [client, props.projectId],
  );
  const load = useCallback(
    (engine: AgentEngine) =>
      queryClient.fetchQuery(engineProfileQuery(readProfile, engine, props.projectId)),
    [props.projectId, queryClient, readProfile],
  );
  // 只订阅缓存，发现请求仍由共享状态触发；会话正在使用的配置不能被空闲 GC 回收。
  useQuery({ ...engineProfileQuery(readProfile, "claude", props.projectId), enabled: false });
  const invalidateProfile = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["engine-profile"], refetchType: "none" });
  }, [queryClient]);
  const state = useEngineComposerState({
    scope,
    profileScope: props.projectId,
    cachedProfile: queryClient.getQueryData(profileQueryKey),
    invalidateProfile,
    taskId: props.taskId,
    taskEngine: props.runtime?.metadata?.engine,
    ...(props.initialEngine === undefined ? {} : { initialEngine: props.initialEngine }),
    codexConfigured: connection.isPending ? undefined : connection.data?.state === "connected",
    load,
  });
  const [override, setOverride] = useState<
    { scope: string; settings: AgentTaskSettings } | undefined
  >(() =>
    props.onCaptureSubmission && props.settings.engineOptions?.engine === "claude"
      ? { scope, settings: props.settings }
      : undefined,
  );
  const claude = state.engine === "claude";
  const models = state.pending
    ? emptyModels
    : claude
      ? (state.profile?.models.data ?? emptyModels)
      : props.models;
  const settings = claude
    ? resolveClaudeComposerSettings(
        override?.scope === scope ? override.settings : props.settings,
        models,
        state.profile?.settings,
      )
    : resolveCodexComposerSettings(props.settings, props.models);
  const controls = (
    <>
      <AgentEngineSelector
        codexAvailable={state.codexConfigured}
        claudeAvailable={state.claudeConfigured}
        label={t("engine.select")}
        value={state.engine}
        locked={state.locked}
        disabled={state.submitting}
        onChange={state.select}
      />
      {claude && state.profile?.connection.state === "disconnected" ? (
        <span role="status" className="text-meta text-muted-foreground">
          {t("engine.configureInSettings")}
        </span>
      ) : null}
    </>
  );
  return (
    <WorkbenchComposerBase
      {...props}
      engineControls={controls}
      {...(claude ? { engineCommands: state.profile?.commands ?? [] } : {})}
      models={models}
      modelsPending={state.pending || (!claude && props.modelsPending)}
      modelsError={claude ? (state.error ?? null) : props.modelsError}
      capabilities={claude ? state.profile?.capabilities : props.capabilities}
      settings={settings}
      skills={claude ? [] : props.skills}
      fastModeAvailable={!claude && props.fastModeAvailable}
      followUpBehavior={props.followUpBehavior}
      onSubmissionStateChange={(submitting) => {
        state.setSubmitting(submitting);
        props.onSubmissionStateChange?.(submitting);
      }}
      onSettingsChange={async (next, field, fastMode) => {
        if (!claude) return props.onSettingsChange(next, field, fastMode);
        if (props.taskId && client.updateTaskSettings)
          await client.updateTaskSettings(props.projectId, props.taskId, next);
        setOverride({ scope, settings: next });
      }}
    />
  );
}
