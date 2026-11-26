import { AcpActivity } from "@codexly/ui/core/acp-activity";
import { useMemo } from "react";
import { useAcpSession, type AcpSessionClient } from "@codexly/ui/core/use-acp-session";
import {
  AcpModelSelector,
  AcpComposerLeading,
  AcpComposerReasoning,
} from "@codexly/ui/core/acp-model-selector";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import { WorkbenchComposerBase } from "./workbench-composer-base.js";
import type { AgentPromptInput } from "@codexly/protocol";

export function WorkbenchAcpComposer(props: WorkbenchComposerProps & { taskId: string }) {
  const { t } = useTranslation("workbench");
  const client = useMemo<AcpSessionClient>(
    () => ({
      getAcpSessionState: (...args) =>
        props.client.getAcpSessionState?.(...args) ??
        Promise.reject(new Error("ACP 会话读取端口不可用")),
      setAcpSessionConfig: (...args) =>
        props.client.setAcpSessionConfig?.(...args) ??
        Promise.reject(new Error("ACP 会话配置端口不可用")),
    }),
    [props.client],
  );
  const session = useAcpSession({
    client,
    projectId: props.projectId,
    taskId: props.taskId,
    ...(props.runtime?.store ? { source: props.runtime.store } : {}),
  });
  const configuration = {
    engine:
      props.runtime?.metadata?.engine ??
      (props.capabilities?.provider === "claude" ? ("claude" as const) : ("codex" as const)),
    client: props.client,
    options: session.session?.configOptions ?? [],
    disabled: session.isPending || session.isSaving || !!props.runtime?.activeTurnId,
    error: session.error,
    language: getCurrentLanguage(),
  };
  const acp = {
    isBusy: session.isPending || session.isSaving || session.error !== null,
    trailingControls: (
      <AcpComposerReasoning
        {...configuration}
        label={t("composer.settingsTitle")}
        onChange={(id, value) => {
          void session.setConfig(id, value);
        }}
      />
    ),
    leadingControls: (
      <AcpComposerLeading
        {...configuration}
        label={t("composer.settingsTitle")}
        onChange={(id, value) => {
          void session.setConfig(id, value);
        }}
      />
    ),
    controls: (
      <AcpModelSelector
        {...configuration}
        engine={
          props.runtime?.metadata?.engine ??
          (props.capabilities?.provider === "claude" ? "claude" : "codex")
        }
        locked
        onSelect={(_engine, id, value) => {
          void session.setConfig(id, value);
        }}
      />
    ),
    submit: (input: AgentPromptInput, key: string) =>
      session.runConfigured(() =>
        props.client.submitTask(
          props.projectId,
          { type: "acp-prompt", taskId: props.taskId, input },
          { idempotencyKey: key },
        ),
      ),
  };
  // 复用编辑器和草稿；旧模型目录、全局设置及专用快速模式均不参与 ACP 发送。
  return (
    <>
      <AcpActivity
        key={props.taskId}
        session={session.session}
        turnId={props.runtime?.activeTurnId ?? null}
        language={configuration.language}
      />
      <WorkbenchComposerBase
        {...props}
        settings={undefined}
        acp={acp}
        models={[]}
        modelsPending={false}
        modelsError={null}
        fastModeAvailable={false}
      />
    </>
  );
}
