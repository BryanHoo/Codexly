import { loadSidebarTimelineRecent } from "@codexly/frontend-core/sidebar-timeline-recent";
import type { readSidebarTimelineCollapsedGroups } from "@codexly/frontend-core/sidebar-task-view";
import { SidebarTaskTimeline } from "@codexly/ui/core/sidebar-task-timeline";
import { TEMPORARY_TASK_SCOPE_ID, type AgentTask } from "@/protocol/index.js";
import type { ReactNode } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { useProjectData } from "../../projects/project-context.js";
import { listProjectTasksForTimeline } from "../../projects/project-queries.js";

export function ProjectSidebarTimeline({ renderTask, onNavigate, storage }: Readonly<{
  renderTask: (task: AgentTask) => ReactNode;
  onNavigate?: (() => void) | undefined;
  storage?: Parameters<typeof readSidebarTimelineCollapsedGroups>[0];
}>) {
  const { t } = useTranslation("workbench");
  const { client, projects } = useProjectData();
  return <SidebarTaskTimeline
    // oxlint-disable-next-line @tanstack/query/exhaustive-deps -- Client 由 Provider 固定，沿用目录键共享跨视图缓存。
    queries={[TEMPORARY_TASK_SCOPE_ID, ...projects.map(project => project.id)].map(id => ({ queryKey: ["projects", id, "tasks", "search-source"], queryFn: ({ signal }) => listProjectTasksForTimeline(id, client, signal), recentQueryFn: ({ signal, since }) => loadSidebarTimelineRecent(cursor => client.listTasks(id, { limit: 100, ...(cursor === undefined ? {} : { cursor }) }, { signal }), since) }))}
    storage={storage}
    onNavigate={onNavigate}
    renderTask={renderTask}
    labels={{ title: t("sidebar.timeline.title"), loading: t("sidebar.taskLoading"), empty: t("sidebar.noTasks"), error: t("sidebar.errorLoadTasks"), retry: t("actions.retry"),
      groups: { today: t("sidebar.timeline.today"), yesterday: t("sidebar.timeline.yesterday"), week: t("sidebar.timeline.week"), earlier: t("sidebar.timeline.earlier") } }} />;
}
