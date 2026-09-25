import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AgentFileChange } from "../../features/diff/file-change.js";
import { legacyDiffLines } from "./diff-lines.js";

export default function PatchDiffViewer({ change }: Readonly<{ change: AgentFileChange }>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => legacyDiffLines(change.diff), [change.diff]);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 16,
    initialRect: { width: 800, height: 600 },
  });
  // 兼容版使用普通 DOM 与虚拟行，避免 Shadow DOM 样式表补丁和大补丁全量渲染。
  return (
    <div className="legacy-diff" ref={scrollRef} aria-label={change.path}>
      <div className="legacy-diff-rows" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index];
          if (!line) return null;
          return (
            <div className="legacy-diff-line" data-kind={line.kind} key={item.key} style={{ transform: `translateY(${item.start}px)` }}>
              <span className="legacy-diff-number">{line.oldLine}</span>
              <span className="legacy-diff-number">{line.newLine}</span>
              <span>{line.kind === "+" || line.kind === "-" ? line.kind : " "} {line.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
