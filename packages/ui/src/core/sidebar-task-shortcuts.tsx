import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getSidebarShortcutLayout,
  readSidebarShortcutExpanded,
  writeSidebarShortcutExpanded,
  type SidebarActiveTask,
} from "@codexly/frontend-core/sidebar-task-shortcuts";
import { SidebarShortcutGroup } from "./sidebar-shortcut-group.js";

type PinnedIdentity = Readonly<{ id: string; projectId?: string }>;
type ShortcutsProps<T extends PinnedIdentity> = Readonly<{
  pinnedTasks: readonly T[];
  activeTasks: readonly SidebarActiveTask[];
  approvalCount: number;
  renderPinned: (task: T) => ReactNode;
  renderActive: (task: SidebarActiveTask) => ReactNode;
  storage?: Parameters<typeof readSidebarShortcutExpanded>[0];
  mobileEnabled?: boolean;
  onNavigate?: (() => void) | undefined;
  labels: Readonly<{
    pinned: string;
    active: string;
    approval: (count: number) => string;
    showAll: (count: number) => string;
    close: string;
  }>;
}>;
const taskKey = (task: PinnedIdentity) => `${task.projectId ?? ""}\u0000${task.id}`;

export function SidebarTaskShortcuts<T extends PinnedIdentity>({
  pinnedTasks,
  activeTasks,
  approvalCount,
  renderPinned,
  renderActive,
  storage,
  mobileEnabled = false,
  onNavigate,
  labels,
}: ShortcutsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(() => readSidebarShortcutExpanded(storage));
  const [availableHeight, setAvailableHeight] = useState(720);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    // 观察任务导航区本身，而非视口；顶部入口、系统缩放和窗口调整都遵守共同预算。
    const measure = () => {
      setAvailableHeight(parent.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => {
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!mobileEnabled) return;
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => {
      setMobile(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, [mobileEnabled]);
  const layout = getSidebarShortcutLayout(
    availableHeight,
    pinnedTasks.length,
    activeTasks.length,
    expanded.pinned,
    expanded.active,
  );
  const toggle = (group: "pinned" | "active") => {
    setExpanded((current) => {
      const next = { ...current, [group]: !current[group] };
      writeSidebarShortcutExpanded(storage, next);
      return next;
    });
  };
  return (
    <div
      ref={containerRef}
      data-testid="sidebar-task-shortcuts"
      className="flex shrink-0 flex-col gap-2"
      style={{ height: layout.height }}
    >
      {pinnedTasks.length > 0 ? (
        <SidebarShortcutGroup
          name="pinned"
          title={labels.pinned}
          summary={pinnedTasks.length}
          tasks={pinnedTasks}
          taskKey={taskKey}
          renderTask={renderPinned}
          limit={layout.pinnedLimit}
          expanded={expanded.pinned}
          onToggle={() => {
            toggle("pinned");
          }}
          mobile={mobile}
          showAll={labels.showAll(pinnedTasks.length)}
          closeLabel={labels.close}
          onNavigate={onNavigate}
        />
      ) : null}
      {activeTasks.length > 0 ? (
        <SidebarShortcutGroup
          name="active"
          title={labels.active}
          summary={
            <>
              {/* 分组总数涵盖未查看完成、待审批和运行任务，与完整列表入口保持一致。 */}
              <span>{activeTasks.length}</span>
              {approvalCount > 0 ? (
                <span className="text-task-waiting">· {labels.approval(approvalCount)}</span>
              ) : null}
            </>
          }
          tasks={activeTasks}
          taskKey={taskKey}
          renderTask={renderActive}
          limit={layout.activeLimit}
          expanded={expanded.active}
          onToggle={() => {
            toggle("active");
          }}
          mobile={mobile}
          showAll={labels.showAll(activeTasks.length)}
          closeLabel={labels.close}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
}
