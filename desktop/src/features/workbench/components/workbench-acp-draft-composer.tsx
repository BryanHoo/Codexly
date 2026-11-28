import { useMemo } from "react";
import { AgentQuotaControl } from "@codexly/ui/core/agent-quota-control";
import { useAcpDraftComposer } from "@codexly/ui/core/acp-draft-composer";
import { createAcpComposerQueueClient } from "../../../platform/tauri/acp-composer-client.js";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { WorkbenchComposerBase } from "./workbench-composer-base.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";

export function WorkbenchAcpDraftComposer(props: WorkbenchComposerProps) {
  const { t } = useTranslation("workbench");
  const capture = props.scheduledCapture;
  const queueClient = useMemo(() => createAcpComposerQueueClient(props.client), [props.client]);
  const draft = useAcpDraftComposer({
    client: props.client,
    projectId: props.projectId,
    workspace: props.projectPath,
    ...(props.composerDraftId ? { draftId: props.composerDraftId } : {}),
    ...(capture?.initialConfig.engine ? { initialEngine: capture.initialConfig.engine } : props.initialEngine ? { initialEngine: props.initialEngine } : {}),
    ...(capture ? { planConfig: capture.initialConfig } : {}),
    configurationLabel: t("composer.settingsTitle"),
    engineLabel: t("engine.select"),
    retryLabel: t("actions.retry"),
    language: getCurrentLanguage(),
  });
  return (
    <WorkbenchComposerBase
      {...props}
      models={[]}
      modelsPending={false}
      modelsError={null}
      fastModeAvailable={false}
      settings={undefined}
      acp={{
        availableCommands: draft.preview.availableCommands ?? [],
        ...(capture ? {
          capture: (input, attachments) => capture.onCapture(input, attachments, draft.engine, draft.preview.values),
          captureConfigChanged: !draft.isPending && (
            (capture.initialConfig.engine !== undefined && capture.initialConfig.engine !== draft.engine) ||
            JSON.stringify(capture.initialConfig.values) !== JSON.stringify(draft.preview.values)
          ),
        } : {}),
        controls: draft.controls,
        leadingControls: draft.leadingControls,
        quotaControl: <AgentQuotaControl engine={draft.engine} client={props.client} language={getCurrentLanguage()} />,
        trailingControls: draft.trailingControls,
        isBusy: draft.isBusy,
        queueClient,
        submit: (input, key) =>
          draft.submit(input, key, async (delivery) => {
            const create = props.client.createAcpTask,
              send = props.client.startConfiguredAcpPrompt,
              read = props.client.getAcpTask;
            if (!create || !send || !read) throw new Error("ACP 新建任务端口不可用");
            // 创建意图与 prompt 请求身份分离；配置变化不能分配第二个应用任务。
            const task = await create.call(props.client, props.projectId, draft.engine, {
              idempotencyKey: delivery.creationKey,
              ...(props.projectId !== "temporary" && props.projectPath
                ? { workspacePath: props.projectPath }
                : {}),
            });
            const turn = await send.call(
              props.client,
              props.projectId,
              task.id,
              input,
              delivery.key,
              delivery.overrides ? undefined : (delivery.values ?? undefined),
              delivery.recoveryKey,
              undefined,
              delivery.overrides && delivery.values && Object.keys(delivery.values).length ? delivery.values : undefined,
            );
            // 交接实际读取边界内的正文，不能仅用新的 checkpoint 配对较早的回合响应。
            const acpSnapshot = await read.call(props.client, props.projectId, task.id);
            if (
              acpSnapshot.snapshot.runtime !== "acp" ||
              acpSnapshot.snapshot.id !== task.id ||
              acpSnapshot.snapshot.projectId !== props.projectId
            )
              throw new Error("ACP 任务快照归属不匹配");
            return { createdTask: task, turn, checkpoint: acpSnapshot.checkpoint, acpSnapshot };
          }),
        interrupt: (taskId, turnId) => {
          const cancel = props.client.interruptAcpTurn;
          if (!cancel) return Promise.reject(new Error("ACP 取消端口不可用"));
          return cancel.call(props.client, props.projectId, taskId, turnId);
        },
      }}
    />
  );
}
