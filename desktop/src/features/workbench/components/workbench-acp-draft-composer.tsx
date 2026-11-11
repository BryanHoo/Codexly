import { useMemo } from "react";
import { useAcpDraftComposer } from "@codexly/ui/core/acp-draft-composer";
import type { AcpDraftClient } from "@codexly/ui/core/use-acp-draft";
import { createAcpComposerQueueClient } from "../../../platform/tauri/acp-composer-client.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { WorkbenchComposerBase } from "./workbench-composer-base.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";

export function WorkbenchAcpDraftComposer(props: WorkbenchComposerProps) {
  const { t } = useTranslation("workbench");
  const client = useMemo<AcpDraftClient>(
    () => ({
      previewAcpConfig: (...args) => {
        const preview = props.client.previewAcpConfig;
        if (!preview) return Promise.reject(new Error("ACP 草稿预览端口不可用"));
        return preview.call(props.client, ...args);
      },
    }),
    [props.client],
  );
  const queueClient = useMemo(() => createAcpComposerQueueClient(props.client), [props.client]);
  const draft = useAcpDraftComposer({
    client,
    projectId: props.projectId,
    workspace: props.projectPath,
    ...(props.composerDraftId ? { draftId: props.composerDraftId } : {}),
    ...(props.initialEngine ? { initialEngine: props.initialEngine } : {}),
    configurationLabel: t("composer.settingsTitle"),
    engineLabel: t("engine.select"),
    retryLabel: t("actions.retry"),
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
        controls: draft.controls,
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
              delivery.values,
              delivery.recoveryKey,
            );
            // 交接实际读取边界内的正文，不能仅用新的 checkpoint 配对较早的回合响应。
            const acpSnapshot = await read.call(props.client, props.projectId, task.id);
            if (acpSnapshot.snapshot.runtime !== "acp" || acpSnapshot.snapshot.id !== task.id || acpSnapshot.snapshot.projectId !== props.projectId)
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
