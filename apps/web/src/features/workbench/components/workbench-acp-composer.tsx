import { useMemo } from "react";
import { useAcpSession, type AcpSessionClient } from "@codexly/ui/core/use-acp-session";
import { AcpComposerConfiguration } from "@codexly/ui/core/acp-composer-configuration";
import { useTranslation } from "../../../i18n/i18n.js";
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
  const acp = {
    isBusy: session.isPending || session.isSaving || session.error !== null,
    controls: (
      <AcpComposerConfiguration
        options={session.session?.configOptions ?? []}
        disabled={session.isPending || session.isSaving || !!props.runtime?.activeTurnId}
        error={session.error}
        label={t("composer.settingsTitle")}
        onChange={(id, value) => {
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
  const capabilities = props.capabilities
    ? { ...props.capabilities, turns: { ...props.capabilities.turns, steer: false } }
    : undefined;
  return (
    <WorkbenchComposerBase
      {...props}
      settings={undefined}
      acp={acp}
      capabilities={capabilities}
      models={[]}
      modelsPending={false}
      modelsError={null}
      fastModeAvailable={false}
    />
  );
}
