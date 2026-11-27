export type AgentTaskScope = Readonly<{
  id: string;
  kind: "project" | "temporary";
  // rootPath 固定为项目主目录；运行时根列表独立控制 Agent 可访问的工作区。
  rootPath: string;
  runtimeWorkspaceRoots: readonly string[];
}>;
