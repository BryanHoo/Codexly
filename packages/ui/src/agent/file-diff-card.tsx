import "./file-diff-card.css";
import { ChevronDown, FilePenLine } from "lucide-react";
import { memo, type ReactNode } from "react";
import { formatDisplayPath } from "@codexly/frontend-core/display-path";
import { Button } from "../core/button.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../core/collapsible.js";

/** AI Elements 折叠组合沿用工作台令牌；高亮正文折叠后卸载，两端共用紧凑密度。 */
export const FileDiffCard = memo(function FileDiffCard({
  path,
  additions,
  removals,
  status,
  statusLabel,
  openLabel,
  onOpen,
  children,
}: Readonly<{
  path: string;
  additions: number;
  removals: number;
  status: string;
  statusLabel: string;
  openLabel: string;
  onOpen: () => void;
  children: ReactNode;
}>) {
  // 文件名优先保留，目录作为次级上下文截断；完整路径仍可悬停查看及由读屏读取。
  const displayPath = formatDisplayPath(path).replaceAll("\\", "/");
  const separator = displayPath.lastIndexOf("/");
  const name = displayPath.slice(separator + 1);
  const directory = displayPath.slice(0, separator + 1);
  return (
    <Collapsible
      defaultOpen
      className="agent-file-diff-card"
      data-file-diff-card=""
      data-status={status}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="embedded"
          type="button"
          className="agent-file-diff-header"
          aria-label={displayPath}
          title={displayPath}
        >
          <FilePenLine className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="agent-file-diff-location">
            <span className="agent-file-diff-name" data-file-diff-name="">
              {name}
            </span>
            {directory ? <span className="agent-file-diff-directory">{directory}</span> : null}
          </span>
          <span className="agent-file-diff-stats">
            <span className="text-diff-added" data-zero={additions === 0}>
              +{additions}
            </span>
            <span className="text-diff-removed" data-zero={removals === 0}>
              −{removals}
            </span>
          </span>
          <ChevronDown className="agent-file-diff-chevron size-3.5" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* 限制正文而非整卡高度，长补丁内部滚动，标题和状态入口始终可见。 */}
        <div className="agent-file-diff-content" data-file-diff-content="">
          {children}
        </div>
      </CollapsibleContent>
      <div className="agent-file-diff-footer">
        <span role="status" className="agent-file-diff-status">
          <span className="agent-file-diff-status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
        <Button
          variant="ghost"
          size="embedded"
          type="button"
          className="agent-file-diff-open"
          onClick={onOpen}
        >
          {openLabel}
          <span aria-hidden="true">↗</span>
        </Button>
      </div>
    </Collapsible>
  );
});
