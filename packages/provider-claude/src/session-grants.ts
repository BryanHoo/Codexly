import type { Options, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

/** 只重放 SDK 明确给出的增量授权或编辑许可，不自行生成工具规则或绕过审批模式。 */
export function canReplaySessionGrants(updates: PermissionUpdate[]): boolean {
  return (
    updates.length > 0 &&
    updates.every(
      (update) =>
        (update.type === "addRules" && update.behavior === "allow" && update.rules.length > 0) ||
        (update.type === "addDirectories" && update.directories.length > 0) ||
        (update.type === "setMode" && update.mode === "acceptEdits"),
    )
  );
}

/** 应用会话内按聊天持有去重规则；不写入用户、项目配置或 SDK 历史。 */
export class ClaudeSessionGrants {
  readonly #rules = new Set<string>();
  readonly #directories = new Set<string>();
  #mode: "acceptEdits" | undefined;
  #requestedMode: Options["permissionMode"];

  constructor(permissionMode?: Options["permissionMode"]) {
    this.#requestedMode = permissionMode;
  }

  remember(updates: PermissionUpdate[]): void {
    if (!canReplaySessionGrants(updates)) throw new Error("Unsupported session permission update");
    for (const update of updates) {
      if (update.type === "addRules") {
        for (const rule of update.rules) {
          // 仅转换 SDK 的原生规则表示，命令、路径、通配符均由 SDK 自己匹配。
          this.#rules.add(
            rule.ruleContent === undefined
              ? rule.toolName
              : `${rule.toolName}(${rule.ruleContent})`,
          );
        }
      } else if (update.type === "addDirectories") {
        for (const directory of update.directories) this.#directories.add(directory);
      } else if (update.type === "setMode" && update.mode === "acceptEdits") {
        this.#mode = update.mode;
      }
    }
  }

  options(
    allowedTools: string[],
    permissionMode = this.#requestedMode,
  ): Pick<Options, "allowedTools" | "additionalDirectories" | "permissionMode"> {
    // 显式切换权限模式优先，防止已保存的编辑许可覆盖用户后来选择的 plan/default。
    if (permissionMode !== this.#requestedMode) {
      this.#mode = undefined;
      this.#requestedMode = permissionMode;
    }
    // --allowedTools/--add-dir 都只影响新建进程；不会把本次会话许可写成永久规则。
    return {
      allowedTools: [...new Set([...allowedTools, ...this.#rules])],
      ...(this.#directories.size ? { additionalDirectories: [...this.#directories] } : {}),
      ...(this.#mode ? { permissionMode: this.#mode } : {}),
    };
  }
}
