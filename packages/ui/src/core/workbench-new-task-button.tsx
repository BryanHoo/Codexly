import { Plus } from "lucide-react";
import { Button } from "./button.js";
import { useOpenSplitDraft } from "./split-workspace.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

// 两端标题栏共用新建入口：分屏替换点击按钮所属的窗口，单窗回退到平台草稿路由。
export function WorkbenchNewTaskButton({
  label,
  onNavigate,
  projectId,
}: Readonly<{
  label: string;
  onNavigate: () => void;
  projectId: string;
}>) {
  const openSplitDraft = useOpenSplitDraft();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          onClick={() => {
            // 使用当前窗口的项目身份，避免跨项目分屏时误用全局路由或活动窗口。
            if (!openSplitDraft(projectId)) onNavigate();
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
