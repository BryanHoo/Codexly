import { AcpActivity } from "@codexly/ui/core/acp-activity";
import { useMemo } from "react";
import { useAcpSession, type AcpSessionClient } from "@codexly/ui/core/use-acp-session";
import {
  AcpComposerLeading,
  AcpComposerReasoning,
} from "@codexly/ui/core/acp-model-selector";
import { createAcpComposerQueueClient } from "../../../platform/tauri/acp-composer-client.js";
import { useAcpTaskContinuation } from "@codexly/ui/core/acp-task-continuation";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import { WorkbenchComposerBase } from "./workbench-composer-base.js";

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
  const queueClient = useMemo(() => createAcpComposerQueueClient(props.client), [props.client]);
  const session = useAcpSession({
    client,
    projectId: props.projectId,
    taskId: props.taskId,
    ...(props.runtime?.store ? { source: props.runtime.store } : {}),
  });
  const locked =
    props.runtime?.writeAccess !== undefined && props.runtime.writeAccess !== "writable";
  const configuration = {
    engine:
      props.runtime?.metadata?.engine ??
      (props.capabilities?.provider === "claude" ? ("claude" as const) : ("codex" as const)),
    client: props.client,
    options: session.session?.configOptions ?? [],
    disabled: locked || session.isPending || session.isSaving || !!props.runtime?.activeTurnId,
    error: session.error,
    language: getCurrentLanguage(),
  };
  const continuation = useAcpTaskContinuation({
    ...configuration,
    projectId: props.projectId,
    taskId: props.taskId,
    workspace: props.runtime?.metadata?.workspacePath ?? props.projectPath,
    onSelect: (_engine, id, value) => { void session.setConfig(id, value); },
  });
  const acp: NonNullable<WorkbenchComposerProps["acp"]> = {
    // 接续发送归属目标 Agent，命令也必须出自目标草稿的协商结果。
    availableCommands: (continuation.target ? continuation.preview : session.session)?.availableCommands ?? [],
    isBusy: continuation.target ? continuation.busy : session.isPending || session.isSaving || session.error !== null,
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
    controls: continuation.controls,
    ...(continuation.target ? { confirmContinuation: continuation.confirm } : {}),
    queueClient,
    submit: (input, key) => {
      const target = continuation.target;
      if (target) return continuation.submit(input, key, async (delivery) => {
        const create = props.client.createAcpTask;
        const send = props.client.startConfiguredAcpPrompt;
        const read = props.client.getAcpTask;
        if (!create || !send || !read) throw new Error("ACP 接续任务端口不可用");
        const createdTask = await create.call(props.client, props.projectId, target, {
          idempotencyKey: delivery.creationKey,
          continuationSourceTaskId: props.taskId,
        });
        const turn = await send.call(props.client, props.projectId, createdTask.id, input, delivery.key, delivery.values, delivery.recoveryKey, props.taskId);
        const acpSnapshot = await read.call(props.client, props.projectId, createdTask.id);
        if (acpSnapshot.snapshot.runtime !== "acp" || acpSnapshot.snapshot.id !== createdTask.id || acpSnapshot.snapshot.projectId !== props.projectId)
          throw new Error("ACP 接续任务快照归属不匹配");
        return { createdTask, turn, checkpoint: acpSnapshot.checkpoint, acpSnapshot };
      });
      return       session.runConfigured(async () => {
        const send = props.client.startConfiguredAcpPrompt;
        if (!send) throw new Error("ACP 发送端口不可用");
        // 此分支只处理已有任务；原生回合响应沿用真实身份，不合成事件 checkpoint。
        return { turn: await send.call(props.client, props.projectId, props.taskId, input, key) };
      });
    },
    interrupt: async (taskId, turnId) => {
      const cancel = props.client.interruptAcpTurn;
      if (!cancel) throw new Error("ACP 取消端口不可用");
      return cancel.call(props.client, props.projectId, taskId, turnId);
    },
  };
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
