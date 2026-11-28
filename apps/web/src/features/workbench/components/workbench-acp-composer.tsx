import { AgentQuotaControl } from "@codexly/ui/core/agent-quota-control";
import { AcpActivity } from "@codexly/ui/core/acp-activity";
import { useMemo } from "react";
import { useAcpSessionConfigOptions } from "@codexly/ui/core/use-acp-session";
import { useAcpSession, type AcpSessionClient } from "@codexly/ui/core/use-acp-session";
import { AcpComposerLeading, AcpComposerReasoning } from "@codexly/ui/core/acp-model-selector";
import { useAcpTaskContinuation } from "@codexly/ui/core/acp-task-continuation";
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
  const engine =
    props.runtime?.metadata?.engine ??
    (props.capabilities?.provider === "claude" ? ("claude" as const) : ("codex" as const));
  const session = useAcpSession({
    client,
    engine,
    projectId: props.projectId,
    taskId: props.taskId,
    deferConfiguration: true,
    ...(props.runtime?.store ? { source: props.runtime.store } : {}),
  });
  const options = useAcpSessionConfigOptions(engine, session);
  const configuration = {
    engine,
    client: props.client,
    options,
    disabled: session.isPending || session.isSaving || !!props.runtime?.activeTurnId,
    error: session.error,
    language: getCurrentLanguage(),
  };
  const continuation = useAcpTaskContinuation({
    ...configuration,
    projectId: props.projectId,
    taskId: props.taskId,
    workspace: props.runtime?.metadata?.workspacePath ?? props.projectPath,
    onSelect: (_engine, id, value) => {
      void session.setConfig(id, value);
    },
  });
  const controlConfiguration = continuation.target
    ? { ...configuration, engine: continuation.target, options: continuation.preview.configOptions }
    : configuration;
  const changeConfig = continuation.target ? continuation.setConfig : session.setConfig;
  const acp = {
    // 接续发送归属目标 Agent，命令也必须出自目标草稿的协商结果。
    availableCommands:
      (continuation.target ? continuation.preview : session.session)?.availableCommands ?? [],
    isBusy: continuation.target
      ? continuation.busy
      : session.isPending || session.isSaving || session.error !== null,
    quotaControl: (
      <AgentQuotaControl
        engine={continuation.target ?? configuration.engine}
        client={props.client}
        language={getCurrentLanguage()}
      />
    ),
    trailingControls: (
      <AcpComposerReasoning
        {...controlConfiguration}
        label={t("composer.settingsTitle")}
        onChange={(id, value) => {
          void changeConfig(id, value);
        }}
      />
    ),
    leadingControls: (
      <AcpComposerLeading
        {...controlConfiguration}
        label={t("composer.settingsTitle")}
        onChange={(id, value) => {
          void changeConfig(id, value);
        }}
      />
    ),
    controls: continuation.controls,
    configurationIntent: session.overrides,
    ...(continuation.target ? { confirmContinuation: continuation.confirm } : {}),
    submit: (input: AgentPromptInput, key: string) => {
      const target = continuation.target;
      if (target)
        return continuation.submit(input, key, async (delivery) => {
          const read = props.client.readTask;
          if (!read) throw new Error("ACP 任务读取端口不可用");
          const result = await props.client.submitTask(
            props.projectId,
            {
              type: "acp-prompt",
              engine: target,
              input,
              ...(delivery.overrides
                ? { initialConfig: null, configOverrides: delivery.values ?? {} }
                : { initialConfig: delivery.values ?? {} }),
              continuationSourceTaskId: props.taskId,
              ...(delivery.recoveryKey ? { recoveryKey: delivery.recoveryKey } : {}),
            },
            { idempotencyKey: delivery.key },
          );
          const acpSnapshot = await read.call(props.client, props.projectId, result.taskId);
          if (
            acpSnapshot.snapshot.runtime !== "acp" ||
            acpSnapshot.snapshot.id !== result.taskId ||
            acpSnapshot.snapshot.projectId !== props.projectId
          )
            throw new Error("ACP 接续任务快照归属不匹配");
          return { ...result, acpSnapshot };
        });
      return session.runConfigured((overrides) =>
        props.client.submitTask(
          props.projectId,
          {
            type: "acp-prompt",
            taskId: props.taskId,
            input,
            ...(overrides ? { configOverrides: overrides } : {}),
          },
          { idempotencyKey: key },
        ),
      );
    },
  };
  // 复用编辑器和草稿；旧模型目录、全局设置及专用快速模式均不参与 ACP 发送。
  return (
    <>
      <AcpActivity
        key={props.taskId}
        session={session.session}
        turnId={props.runtime?.activeTurnId ?? null}
        taskFailed={props.runtime?.metadata?.status === "failed"}
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
