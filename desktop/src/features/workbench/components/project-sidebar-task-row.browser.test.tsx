import type { AgentTask } from "@/protocol/index.js";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import {
  TaskActionMenu,
  TaskLink,
  TaskStatusIndicator,
} from "./project-sidebar-task-row.js";
import { TaskInteractionContext } from "../task-interaction-context.js";
const { openTaskWindow } = vi.hoisted(() => ({ openTaskWindow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../platform/tauri/task-window-client.js", () => ({ openTaskWindow }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params: _params, to: _to, ...props }: ComponentProps<"a"> & {
    params?: unknown;
    to?: string;
  }) => <a {...props}>{children}</a>,
}));

const task: AgentTask = {
  id: "task-diagnostic-123",
  pinned: false,
  projectId: "project-a",
  title: "排查异常",
  updatedAt: "2026-09-01T00:00:00Z",
};

describe("TaskActionMenu", () => {
  it("disables all actions for the externally owned task, including an already open menu", async () => {
    const view = (scope: string | null) => <TaskInteractionContext value={scope}>
      <DropdownMenu defaultOpen><DropdownMenuTrigger>菜单</DropdownMenuTrigger>
        <TaskActionMenu isPending={false} onArchive={vi.fn()} onDelete={vi.fn()}
          onPin={vi.fn()} onRename={vi.fn()} task={task} />
      </DropdownMenu>
    </TaskInteractionContext>;
    const screen = await render(view(null));
    await screen.rerender(view(JSON.stringify([task.projectId, task.id])));
    for (const item of document.querySelectorAll('[role="menuitem"]')) {
      expect(item.getAttribute("aria-disabled")).toBe("true");
    }
    await screen.rerender(view(JSON.stringify([task.projectId, "another-task"])));
    expect(document.querySelector('[role="menuitem"][aria-disabled="true"]')).toBeNull();
  });
  it("opens the selected task in a floating window", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>打开任务菜单</DropdownMenuTrigger>
          <TaskActionMenu isPending={false} onArchive={vi.fn()} onDelete={vi.fn()} onPin={vi.fn()} onRename={vi.fn()} task={task} />
        </DropdownMenu>
      </I18nextProvider>,
    );
    await screen.getByRole("menuitem", { name: "小窗访问" }).click();
    await vi.waitFor(() => expect(openTaskWindow).toHaveBeenCalledWith(task.projectId, task.id));
  });
  it("copies the current task ID", async () => {
    await i18n.changeLanguage("zh-CN");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>打开任务菜单</DropdownMenuTrigger>
          <TaskActionMenu
            isPending={false}
            onArchive={vi.fn()}
            onDelete={vi.fn()}
            onPin={vi.fn()}
            onRename={vi.fn()}
            task={task}
          />
        </DropdownMenu>
      </I18nextProvider>,
    );

    const copyItem = screen.getByRole("menuitem", { name: "复制任务 ID" });
    await copyItem.click();

    expect(writeText).toHaveBeenCalledWith(task.id);
  });

  it("使归档与普通菜单项保持同色", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>打开任务菜单</DropdownMenuTrigger>
          <TaskActionMenu
            isPending={false}
            onArchive={vi.fn()}
            onDelete={vi.fn()}
            onPin={vi.fn()}
            onRename={vi.fn()}
            task={task}
          />
        </DropdownMenu>
      </I18nextProvider>,
    );

    const archiveColor = getComputedStyle(
      screen.getByRole("menuitem", { name: "归档" }).element(),
    ).color;
    const renameColor = getComputedStyle(
      screen.getByRole("menuitem", { name: "重命名" }).element(),
    ).color;
    const deleteColor = getComputedStyle(
      screen.getByRole("menuitem", { name: "永久删除" }).element(),
    ).color;

    expect(archiveColor).toBe(renameColor);
    expect(archiveColor).not.toBe(deleteColor);
  });
});

describe("TaskLink", () => {
  it("在父容器内保留完整任务行并单行省略溢出标题", async () => {
    await i18n.changeLanguage("zh-CN");
    const longTask = {
      ...task,
      title: "推送GitHub打包，发布 GitHub Draft 版本到 Release",
    };
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <div data-testid="task-clip-boundary" style={{ overflow: "hidden", width: 288 }}>
          <TaskLink
            active
            attention={null}
            isActionPending={false}
            isAwaitingApproval={false}
            isRunning={false}
            onArchive={vi.fn()}
            onDelete={vi.fn()}
            onPin={vi.fn()}
            onRename={vi.fn()}
            task={longTask}
          />
        </div>
      </I18nextProvider>,
    );

    const boundary = screen.getByTestId("task-clip-boundary").element();
    const title = screen.getByText(longTask.title).element();
    const link = title.closest("a");

    expect(link).not.toBeNull();
    // 标题保持单行省略，任务行同时为 3px 焦点阴影保留裁切安全区。
    expect(getComputedStyle(title).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(title).textOverflow).toBe("ellipsis");
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    expect(
      boundary.getBoundingClientRect().right - link!.getBoundingClientRect().right,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("TaskStatusIndicator", () => {
  it.each([
    {
      attention: "completed" as const,
      iconClass: "lucide-circle-check-big",
      isAwaitingApproval: false,
      label: "AI 回复已完成",
      toneClass: "text-task-completed",
    },
    {
      attention: "approval" as const,
      iconClass: "lucide-clock-3",
      isAwaitingApproval: true,
      label: "任务等待审批",
      toneClass: "text-task-waiting",
    },
    {
      attention: "failed" as const,
      iconClass: "lucide-circle-x",
      isAwaitingApproval: false,
      label: "AI 回复未完成",
      toneClass: "text-task-failed",
    },
  ])("为 $label 显示明确的状态图标和语义色", async ({
    attention,
    iconClass,
    isAwaitingApproval,
    label,
    toneClass,
  }) => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TaskStatusIndicator
          attention={attention}
          isAwaitingApproval={isAwaitingApproval}
          isRunning={false}
          updatedAt={task.updatedAt}
        />
      </I18nextProvider>,
    );

    const indicator = screen.getByRole("status", { name: label }).element();
    const icon = indicator.querySelector("svg");

    expect(indicator.classList.contains(toneClass)).toBe(true);
    expect(icon?.classList.contains(iconClass)).toBe(true);
    expect(getComputedStyle(icon!).width).toBe("14px");
    expect(getComputedStyle(icon!).height).toBe("14px");
  });
});
