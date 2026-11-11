import { useMemo } from "react";
import { useAcpSession, type AcpSessionClient } from "@codexly/ui/core/use-acp-session";
import { AcpComposerConfiguration } from "@codexly/ui/core/acp-composer-configuration";
import { createAcpComposerQueueClient } from "../../../platform/tauri/acp-composer-client.js";
import { useTranslation } from "../../../i18n/i18n.js";
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
  const acp: NonNullable<WorkbenchComposerProps["acp"]> = {
    isBusy: session.isPending || session.isSaving || session.error !== null,
    controls: (
      <AcpComposerConfiguration
        options={session.session?.configOptions ?? []}
        disabled={locked || session.isPending || session.isSaving || !!props.runtime?.activeTurnId}
        error={session.error}
        label={t("composer.settingsTitle")}
        onChange={(id, value) => {
          if (!locked) void session.setConfig(id, value);
        }}
      />
    ),
    queueClient,
    submit: (input, key) =>
      session.runConfigured(async () => {
        const send = props.client.startConfiguredAcpPrompt;
        if (!send) throw new Error("ACP 发送端口不可用");
        // 此分支只处理已有任务；原生回合响应沿用真实身份，不合成事件 checkpoint。
        return { turn: await send.call(props.client, props.projectId, props.taskId, input, key) };
      }),
    interrupt: async (taskId, turnId) => {
      const cancel = props.client.interruptAcpTurn;
      if (!cancel) throw new Error("ACP 取消端口不可用");
      return cancel.call(props.client, props.projectId, taskId, turnId);
    },
  };
  // ACP 不支持 steer；回合运行时沿用持久队列，不能回落旧追加接口。
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
