import type { AgentTask, Project } from "@/protocol/index.js";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "../../../shared/styles/globals.css";
import "../../../shared/styles/task-board.css";
import "../../../shared/styles/workbench.css";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { ProjectDraftRecord } from "../project-draft-store.js";
import type { TaskBoardTask } from "../task-board-state.js";
import { TaskBoard } from "./task-board.js";

const runningTask: AgentTask = {
  id: "running-task",
  pinned: false,
  projectId: "project-a",
  title: "实现任务看板",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const runningBoardTask: TaskBoardTask = {
  ...runningTask,
  startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};

const approvalTask: AgentTask = {
  id: "approval-task",
  pinned: false,
  projectId: "project-a",
  title: "确认文件权限",
  updatedAt: "2026-09-01T09:00:00.000Z",
};

const otherProjectApprovalTask: AgentTask = {
  id: "other-project-task",
  pinned: false,
  projectId: "project-b",
  title: "校验聚合查询",
  updatedAt: "2026-09-01T08:45:00.000Z",
};

const projects: readonly Project[] = [
  {
    createdAt: "2026-09-01T07:00:00.000Z",
    id: "project-a",
    name: "CodeAgent",
    roots: [{ id: "root-a", path: "/code-agent" }],
  },
  {
    createdAt: "2026-09-01T07:10:00.000Z",
    id: "project-b",
    name: "Dashi",
    roots: [{ id: "root-b", path: "/dashi" }],
  },
];

const draft: ProjectDraftRecord = {
  createdAt: Date.parse("2026-09-01T08:00:00.000Z"),
  draft: {
    attachments: [],
    content: [{ text: "补充性能基线", type: "text" }],
  },
  id: "draft-a",
  updatedAt: Date.parse("2026-09-01T08:30:00.000Z"),
};

const completedTasks: readonly AgentTask[] = Array.from({ length: 10 }, (_, index) => ({
  id: `completed-${String(index)}`,
  pinned: false,
  projectId: "project-b",
  title: `已完成任务 ${String(index + 1)}`,
  updatedAt: new Date(Date.parse("2026-09-01T08:00:00.000Z") - index * 1_000).toISOString(),
}));

function TaskBoardHarness({
  completedError = false,
  onCreateTask,
  onLoadMoreCompleted,
  onOpenDraft,
  onRetryCompleted = vi.fn(),
  onOpenTask,
  unviewedCompletedTaskKeys = new Set(),
}: Readonly<{
  completedError?: boolean;
  onCreateTask: (projectId: string | null) => void;
  onLoadMoreCompleted: () => Promise<void>;
  onOpenDraft: (draft: { projectId: string; record: ProjectDraftRecord }) => void;
  onRetryCompleted?: () => void;
  onOpenTask: (task: TaskBoardTask) => void;
  unviewedCompletedTaskKeys?: ReadonlySet<string>;
}>) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  return (
    <TooltipProvider delayDuration={0}>
      <TaskBoard
        completed={completedTasks}
        completedError={completedError}
        drafts={[{ projectId: "project-a", record: draft }]}
        hasNextCompletedPage
        isCompletedPending={false}
        isLoadingMoreCompleted={false}
        isTaskUnviewed={(projectId, taskId) =>
          unviewedCompletedTaskKeys.has(`${projectId}\u0000${taskId}`)
        }
        onCreateTask={onCreateTask}
        onLoadMoreCompleted={onLoadMoreCompleted}
        onOpenDraft={onOpenDraft}
        onOpenTask={onOpenTask}
        onProjectFilterChange={setSelectedProjectId}
        onRetryCompleted={onRetryCompleted}
        approval={[approvalTask, otherProjectApprovalTask]}
        projects={projects}
        running={[runningBoardTask]}
        selectedProjectId={selectedProjectId}
      />
    </TooltipProvider>
  );
}

describe("TaskBoard", () => {
  it("展示四列任务、过滤项目并在完成列滚动到底时加载下一页", async () => {
    await i18n.changeLanguage("zh-CN");
    const onCreateTask = vi.fn();
    const onLoadMoreCompleted = vi.fn(async () => undefined);
    const onOpenDraft = vi.fn();
    const onOpenTask = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <div className="flex h-[360px]">
          <TaskBoardHarness
          onCreateTask={onCreateTask}
          onLoadMoreCompleted={onLoadMoreCompleted}
          onOpenDraft={onOpenDraft}
          onOpenTask={onOpenTask}
          />
        </div>
      </I18nextProvider>,
    );

    await expect.element(screen.getByRole("heading", { name: "待办 1" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "运行中 1" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "待审批 2" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "已完成 10" })).toBeVisible();

    await expect.element(screen.getByRole("combobox", { name: "项目过滤" })).toHaveTextContent(
      "全部项目",
    );
    await screen.getByRole("combobox", { name: "项目过滤" }).click();
    await screen.getByRole("option", { name: "Dashi" }).click();

    await expect.element(screen.getByRole("heading", { name: "待办 0" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "运行中 0" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "待审批 1" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "已完成 10" })).toBeVisible();

    const completedList = screen.getByRole("list", { name: "已完成 10" }).element();
    completedList.scrollTop = completedList.scrollHeight - completedList.clientHeight;
    completedList.dispatchEvent(new Event("scroll", { bubbles: true }));

    await screen.getByRole("button", { name: "打开任务：校验聚合查询" }).click();
    await screen.getByRole("button", { name: "新建任务" }).click();

    expect(onOpenDraft).not.toHaveBeenCalled();
    expect(onOpenTask).toHaveBeenCalledWith(otherProjectApprovalTask);
    expect(onCreateTask).toHaveBeenCalledWith("project-b");
    await vi.waitFor(() => expect(onLoadMoreCompleted).toHaveBeenCalledOnce());
  });

  it("完成任务加载失败时保留看板并在完成列提供重试", async () => {
    await i18n.changeLanguage("zh-CN");
    const onRetryCompleted = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <div className="flex h-[360px]">
          <TaskBoardHarness
            completedError
            onCreateTask={vi.fn()}
            onLoadMoreCompleted={vi.fn(async () => undefined)}
            onOpenDraft={vi.fn()}
            onOpenTask={vi.fn()}
            onRetryCompleted={onRetryCompleted}
          />
        </div>
      </I18nextProvider>,
    );

    await expect.element(screen.getByRole("heading", { name: "待办 1" })).toBeVisible();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("已完成任务加载失败");
    await screen.getByRole("button", { name: "重新加载已完成任务" }).click();
    expect(onRetryCompleted).toHaveBeenCalledOnce();
  });

  it("用等高单行卡片展示真实任务元数据", async () => {
    await i18n.changeLanguage("zh-CN");
    const onOpenTask = vi.fn();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <div className="flex h-[360px] w-[1280px]">
          <TaskBoardHarness
            onCreateTask={vi.fn()}
            onLoadMoreCompleted={vi.fn(async () => undefined)}
            onOpenDraft={vi.fn()}
            onOpenTask={onOpenTask}
          />
        </div>
      </I18nextProvider>,
    );

    await expect.element(screen.getByText("ID: running-task")).toBeVisible();
    await expect.element(screen.getByText("CodeAgent", { exact: true }).first()).toBeVisible();
    await expect.element(screen.getByText("运行中", { exact: true }).last()).toBeVisible();
    await expect.element(screen.getByText("已运行 5m", { exact: true })).toBeVisible();
    expect(document.querySelector(".task-board-column[data-tone='running'] .lucide-activity")).not.toBeNull();

    const title = screen.getByText("实现任务看板").element();
    expect(getComputedStyle(title).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(title).textOverflow).toBe("ellipsis");
    await screen.getByRole("button", { name: "打开任务：实现任务看板" }).hover();
    await expect.element(screen.getByRole("tooltip")).toHaveTextContent("实现任务看板");

    await screen.getByRole("button", { name: "复制任务 ID：running-task" }).click();
    expect(writeText).toHaveBeenCalledWith("running-task");
    expect(onOpenTask).not.toHaveBeenCalled();

    const cards = Array.from(document.querySelectorAll<HTMLElement>(".task-board-card"));
    expect(cards.length).toBeGreaterThan(2);
    expect(new Set(cards.map((card) => card.getBoundingClientRect().height)).size).toBe(1);
  });

  it("突出显示未查看的新完成任务并保持旧完成任务为普通样式", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <div className="flex h-[360px] w-[1280px]" style={{ colorScheme: "light" }}>
          <TaskBoardHarness
            onCreateTask={vi.fn()}
            onLoadMoreCompleted={vi.fn(async () => undefined)}
            onOpenDraft={vi.fn()}
            onOpenTask={vi.fn()}
            unviewedCompletedTaskKeys={new Set(["project-b\u0000completed-0"])}
          />
        </div>
      </I18nextProvider>,
    );

    const newCompletedCard = screen
      .getByText("已完成任务 1", { exact: true })
      .element()
      .closest(".task-board-card");
    const viewedCompletedCard = screen
      .getByText("已完成任务 2", { exact: true })
      .element()
      .closest(".task-board-card");

    expect(newCompletedCard?.getAttribute("data-attention")).toBe("new-completion");
    expect(viewedCompletedCard?.hasAttribute("data-attention")).toBe(false);
    await expect.element(screen.getByText("新完成", { exact: true })).toBeVisible();
    expect(getComputedStyle(newCompletedCard!).borderLeftWidth).toBe("3px");
    expect(getComputedStyle(newCompletedCard!).backgroundColor).not.toBe(
      getComputedStyle(viewedCompletedCard!).backgroundColor,
    );
  });

  it("以留白分隔灰色任务池并仅在列头使用状态底色", async () => {
    await i18n.changeLanguage("zh-CN");
    await render(
      <I18nextProvider i18n={i18n}>
        <div className="flex h-[720px] w-[1280px]" style={{ colorScheme: "light" }}>
          <TaskBoardHarness
            onCreateTask={vi.fn()}
            onLoadMoreCompleted={vi.fn(async () => undefined)}
            onOpenDraft={vi.fn()}
            onOpenTask={vi.fn()}
          />
        </div>
      </I18nextProvider>,
    );

    const board = document.querySelector<HTMLElement>(".task-board");
    const grid = document.querySelector<HTMLElement>(".task-board-grid");
    const column = document.querySelector<HTMLElement>(".task-board-column");
    const header = document.querySelector<HTMLElement>(".task-board-column-header");
    const list = document.querySelector<HTMLElement>(".task-board-column-list");
    const card = document.querySelector<HTMLElement>(".task-board-card");

    expect(board).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(column).not.toBeNull();
    expect(header).not.toBeNull();
    expect(list).not.toBeNull();
    expect(card).not.toBeNull();

    const boardStyle = getComputedStyle(board!);
    const gridStyle = getComputedStyle(grid!);
    const columnStyle = getComputedStyle(column!);
    const headerStyle = getComputedStyle(header!);
    const listStyle = getComputedStyle(list!);
    const cardStyle = getComputedStyle(card!);

    expect(gridStyle.backgroundColor).toBe(boardStyle.backgroundColor);
    expect(parseFloat(gridStyle.paddingTop)).toBeGreaterThan(0);
    expect(parseFloat(gridStyle.paddingLeft)).toBeGreaterThan(0);
    expect(parseFloat(gridStyle.columnGap)).toBeGreaterThan(1);
    expect(parseFloat(columnStyle.rowGap)).toBeGreaterThan(1);
    expect(columnStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(parseFloat(columnStyle.borderTopWidth)).toBe(0);
    expect(listStyle.backgroundColor).not.toBe(boardStyle.backgroundColor);
    expect(parseFloat(listStyle.borderTopWidth)).toBe(0);
    expect(headerStyle.backgroundColor).not.toBe(listStyle.backgroundColor);
    expect(cardStyle.boxShadow).not.toContain("inset");
  });
});
