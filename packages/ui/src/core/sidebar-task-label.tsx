import type { AgentEngine } from "@codexly/protocol";
import { AgentEngineIcon } from "./agent-engine-icon.js";

type SidebarTaskLabelProps = Readonly<{
  engine: AgentEngine | undefined;
  projectName?: string | undefined;
  title: string;
}>;

export function SidebarTaskLabel({ engine, projectName, title }: SidebarTaskLabelProps) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {/* 图标始终跟随任务绑定的 Agent，停用 Agent 或暂未加载配置时仍可辨认历史任务。 */}
      <AgentEngineIcon engine={engine} />
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
