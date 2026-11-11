import { useMemo } from "react";
import { useAcpDraftComposer } from "@codexly/ui/core/acp-draft-composer";
import type { AcpDraftClient } from "@codexly/ui/core/use-acp-draft";
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
  const workspacePath =
    props.projectId !== "temporary" && props.projectPath ? props.projectPath : undefined;
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
        submit: (input, key) =>
          draft.submit(input, key, async (delivery) => {
            const read = props.client.readTask;
            if (!read) throw new Error("ACP 任务读取端口不可用");
            const result = await props.client.submitTask(
              props.projectId,
              {
                type: "acp-prompt",
                engine: draft.engine,
                input,
                initialConfig: delivery.values,
                ...(workspacePath === undefined ? {} : { workspacePath }),
                ...(delivery.recoveryKey ? { recoveryKey: delivery.recoveryKey } : {}),
              },
              { idempotencyKey: delivery.key },
            );
            // 正文与 checkpoint 必须来自同一次读取；失败保留原提交身份以安全重试。
            const response = await read.call(props.client, props.projectId, result.taskId);
            const snapshot = response.snapshot;
            if (
              snapshot.runtime !== "acp" ||
              snapshot.id !== result.taskId ||
              snapshot.projectId !== props.projectId
            )
              throw new Error("ACP 任务快照归属不匹配");
            return { ...result, acpSnapshot: { ...response, snapshot } };
          }),
      }}
    />
  );
}
