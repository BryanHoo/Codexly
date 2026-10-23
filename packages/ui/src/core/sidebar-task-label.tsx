import type { AgentEngine } from "@codexly/protocol";
import { AgentEngineIcon } from "./agent-engine-icon.js";
import { useSelectedEngines } from "./engine-selection.js";

type SidebarTaskLabelProps = Readonly<{
  engine: AgentEngine | undefined;
  projectName?: string | undefined;
  title: string;
}>;

export function SidebarTaskLabel({ engine, projectName, title }: SidebarTaskLabelProps) {
  const engines = useSelectedEngines();
  // 仅在两种引擎均已配置时显示品牌标识；单引擎和配置未就绪时不保留图标占位。
  const showEngineIcon = engines?.includes("codex") && engines.includes("claude");
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {showEngineIcon ? <AgentEngineIcon engine={engine} /> : null}
      {/* 跨项目入口保留限宽标签，将剩余空间留给单行标题。 */}
      {projectName !== undefined && (
        <span
          className="max-w-[40%] shrink-0 truncate rounded border border-border px-1 text-caption font-normal text-subtle-foreground"
          title={projectName}
        >
          {projectName}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </span>
    </span>
  );
}
