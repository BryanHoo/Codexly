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
        { value: "claude", label: "Claude Agent" },
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
    onChange: (mode: ClaudePermissionMode) => void;
  }>,
) {
  return (
    <CompactSelector
      label={props.label}
      disabled={props.disabled}
      value={props.value}
      onValueChange={props.onChange}
      options={(["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"] as const).map(
        (value) => ({ value, label: props.labels[value] }),
      )}
    />
  );
}
