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
      {/* 项目标签最多占 72px，窄栏按行宽收缩并直接裁切文字，悬停时可查看完整名称。 */}
      {projectName !== undefined && (
        <span
          className="max-w-[min(72px,30%)] shrink-0 overflow-hidden text-clip whitespace-nowrap rounded border border-border px-1 text-caption font-normal text-subtle-foreground"
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
