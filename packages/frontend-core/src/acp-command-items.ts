import type { AcpAvailableCommand } from "@codexly/protocol";

/** 只投影提示列表；任何名称（包括 fork、compact、plan）都交给 ACP prompt 执行。 */
export function createAcpCommandItems(commands: readonly AcpAvailableCommand[]) {
  return commands.map((command) => ({
    action: "native" as const,
    command: command.name,
    id: `acp:${command.name}`,
    label: `/${command.name}`,
    description: command.description,
    keywords: [command.name],
    ...(command.input ? { argumentHint: command.input.hint } : {}),
  }));
}
