import { useRef, useState } from "react";
import type { AgentEngine, ClaudePermissionMode } from "@codexly/protocol";
import { CompactSelector } from "./compact-selector.js";

export function AgentEngineSelector(
  props: Readonly<{
    codexAvailable: boolean;
    claudeAvailable: boolean;
    value: AgentEngine;
    locked: boolean;
    disabled?: boolean;
    label: string;
    onChange: (engine: AgentEngine) => void;
  }>,
) {
  // 只有两个引擎都已配置才有切换的必要，历史会话也遵守相同的显示规则。
  if (!props.codexAvailable || !props.claudeAvailable) return null;
  return (
    <CompactSelector
      label={props.label}
      disabled={props.locked || props.disabled === true}
      value={props.value}
      onValueChange={props.onChange}
      options={[
        { value: "codex", label: "Codex" },
        { value: "claude", label: "Claude" },
      ]}
    />
  );
}

export function ClaudePermissionSelector(
  props: Readonly<{
    value: ClaudePermissionMode;
    disabled: boolean;
    label: string;
    labels: Readonly<Record<ClaudePermissionMode, string>>;
    onChange: (mode: ClaudePermissionMode) => Promise<void> | void;
  }>,
) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  return (
    <CompactSelector
      label={props.label}
      busy={pending}
      disabled={props.disabled || pending}
      value={props.value}
      onValueChange={(mode) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        // 只等待控制确认，不乐观改写选中项；错误由调用方的统一设置错误区展示。
        void Promise.resolve()
          .then(() => props.onChange(mode))
          .catch(() => {
            // 调用方负责显示失败原因；此处仍须回收等待状态。
          })
          .finally(() => {
            inFlight.current = false;
            setPending(false);
          });
      }}
      options={(
        ["default", "auto", "acceptEdits", "plan", "dontAsk", "bypassPermissions"] as const
      ).map((value) => ({ value, label: props.labels[value] }))}
    />
  );
}
