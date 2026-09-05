import type { AgentTaskSettings } from "@codexly/protocol";
import { useRef } from "react";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";

export function useComposerSettingsUpdate({
  routeScope,
  fastModeSelected,
  onSettingsChange,
  isCurrentScope,
  setSettingsOverride,
  setMutationError,
}: Readonly<{
  routeScope: string;
  fastModeSelected: boolean;
  onSettingsChange: WorkbenchComposerProps["onSettingsChange"];
  isCurrentScope: (scope: string) => boolean;
  setSettingsOverride: (value: { scope: string; settings: AgentTaskSettings } | undefined) => void;
  setMutationError: (error: Error | null) => void;
}>) {
  const revision = useRef(0);
  return (settings: AgentTaskSettings, field: keyof AgentTaskSettings) => {
    const currentRevision = ++revision.current;
    setSettingsOverride({ scope: routeScope, settings });
    setMutationError(null);
    // 只回退最新一次失败的选择，较早请求的错误不能覆盖用户后续修改。
    void Promise.resolve(onSettingsChange(settings, field, fastModeSelected)).catch(
      (error: unknown) => {
        if (isCurrentScope(routeScope) && revision.current === currentRevision) {
          setSettingsOverride(undefined);
          setMutationError(
            error instanceof Error ? error : new Error("Task settings update failed"),
          );
        }
      },
    );
  };
}
