import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DropdownMenu } from "../../../shared/components/core/dropdown-menu.js";
import {
  ProjectActionMenu,
  ProjectActions,
  TaskStatusIndicator,
  TaskActionMenu,
} from "./project-sidebar.js";
import { ProjectRemoveDialog } from "./project-remove-dialog.js";
import { ProjectRenameDialog } from "./project-rename-dialog.js";
import { TaskDeleteDialog } from "./task-delete-dialog.js";

describe("TaskActionMenu", () => {
  it("offers permanent deletion directly after archive", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <TaskActionMenu
          isPending={false}
          onArchive={() => undefined}
          onDelete={() => undefined}
          onPin={() => undefined}
          onRename={() => undefined}
          task={{
            id: "task-1",
            pinned: false,
            projectId: "code-agent",
            title: "结构化历史",
            updatedAt: "2026-07-23T00:01:00.000Z",
          }}
        />
      </DropdownMenu>,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('aria-label="结构化历史 的任务操作"');
    expect(markup).not.toContain("aria-labelledby");
    expect(markup).toContain('data-slot="dropdown-menu-content"');
    expect(markup.match(/data-slot="dropdown-menu-item"/gu)).toHaveLength(4);
    expect(markup).toContain("固定");
    expect(markup).toContain("重命名");
    expect(markup).toContain("归档");
    expect(markup).toContain("永久删除");
    expect(markup.indexOf("归档")).toBeLessThan(markup.indexOf("永久删除"));
  });

  it("requires confirmation before permanently deleting a task", () => {
    const markup = renderToStaticMarkup(
      <TaskDeleteDialog
        isPending={false}
        onClose={() => undefined}
        onDelete={() => undefined}
        task={{
          id: "task-1",
          pinned: false,
          projectId: "code-agent",
          title: "结构化历史",
          updatedAt: "2026-07-23T00:01:00.000Z",
        }}
      />,
    );

    expect(markup).toContain("永久删除任务");
    expect(markup).toContain("结构化历史");
    expect(markup).toContain("此操作无法撤销");
    expect(markup).toContain("取消");
  });
});

describe("Project folder actions", () => {
  const project = {
    createdAt: "2026-07-23T00:00:00.000Z",
    id: "code-agent",
    name: "CodeAgent",
    roots: [{ id: "root-code-agent", path: "/workspace/CodeAgent" }],
  };

  it("hides the action icon until the folder row is hovered or focused", () => {
    const markup = renderToStaticMarkup(
      <ProjectActions
        isPending={false}
        onOpenArchived={() => undefined}
        onRemove={() => undefined}
        onRename={() => undefined}
        project={project}
      />,
    );

    expect(markup).toContain("opacity-0");
    expect(markup).toContain("group-hover/project:opacity-100");
    expect(markup).toContain("focus-visible:opacity-100");
    expect(markup).toContain("data-[state=open]:opacity-100");
  });

  it("offers rename, archived tasks and remove commands in that order", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <ProjectActionMenu
          isPending={false}
          onOpenArchived={() => undefined}
          onRemove={() => undefined}
          onRename={() => undefined}
          project={project}
        />
      </DropdownMenu>,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('aria-label="CodeAgent 的项目操作"');
    expect(markup).not.toContain("aria-labelledby");
    expect(markup).toContain('data-slot="dropdown-menu-content"');
    expect(markup.match(/data-slot="dropdown-menu-item"/gu)).toHaveLength(3);
    expect(markup.indexOf("重命名")).toBeLessThan(markup.indexOf("已归档"));
    expect(markup.indexOf("已归档")).toBeLessThan(markup.indexOf("删除"));
    expect(markup).not.toContain("新建任务");
    expect(markup).toContain("已归档");
  });

  it("explains that rename and removal do not change the disk folder", () => {
    const renameMarkup = renderToStaticMarkup(
      <ProjectRenameDialog
        initialName={project.name}
        isPending={false}
        onClose={() => undefined}
        onRename={() => undefined}
      />,
    );
    const removeMarkup = renderToStaticMarkup(
      <ProjectRemoveDialog
        isPending={false}
        onClose={() => undefined}
        onRemove={() => undefined}
        project={project}
      />,
    );

    expect(renameMarkup).toContain("不会修改磁盘上的文件夹名称");
    expect(removeMarkup).toContain("不会删除磁盘上的文件夹及文件");
  });
});

describe("TaskStatusIndicator", () => {
  it("uses vivid status colors and a fast breathing animation that respects reduced motion", () => {
    const css = ["globals.css", "workbench.css"]
      .map((fileName) =>
        readFileSync(new URL(`../../../shared/styles/${fileName}`, import.meta.url), "utf8"),
      )
      .join("\n");
    const keyframes = css.slice(
      css.indexOf("@keyframes task-status-breathe"),
      css.indexOf(
        "@media (prefers-reduced-motion: reduce)",
        css.indexOf("@keyframes task-status-breathe"),
      ),
    );
    const statusStyles = css.slice(
      css.indexOf(".task-status-dot {"),
      css.indexOf("@media (hover: none)"),
    );

    expect(css).toContain("@keyframes task-status-breathe");
    expect(css).toContain("--ui-color-task-running: light-dark(#087cf0, #2196ff);");
    expect(css).toContain("--ui-color-task-waiting: light-dark(#e59a00, #ffb300);");
    expect(css).toContain("--ui-color-task-completed: light-dark(#4d7c0f, #a3e635);");
    expect(css).toContain("--ui-color-task-failed: light-dark(#ed1b2e, #ff3b4f);");
    expect(css).toContain("animation: task-status-breathe 1.6s");
    expect(keyframes).toContain("opacity: 0.65");
    expect(keyframes).toContain("opacity: 1");
    expect(keyframes).not.toContain("box-shadow");
    expect(statusStyles).not.toContain("box-shadow");
    expect(statusStyles).not.toContain("transform");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.task-status-dot--breathing[\s\S]*?animation: none;/u,
    );
  });

  it("shows a primary breathing dot while running", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention={null}
        isAwaitingApproval={false}
        isRunning
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="任务运行中"');
    expect(markup).toContain("text-task-running");
    expect(markup).toContain("task-status-dot--breathing");
    expect(markup).toContain("size-2");
    expect(markup).not.toContain("lucide-");
    expect(markup).not.toContain("task-age");
  });

  it("shows a yellow breathing dot while awaiting approval", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention={null}
        isAwaitingApproval
        isRunning
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="任务等待审批"');
    expect(markup).toContain("text-task-waiting");
    expect(markup).toContain("task-status-dot--breathing");
    expect(markup).toContain("size-2");
    expect(markup).not.toContain("lucide-");
    expect(markup).not.toContain("animate-spin");
    expect(markup).not.toContain("task-age");
  });

  it("shows a static green dot when the reply completes", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention="completed"
        isAwaitingApproval={false}
        isRunning={false}
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="AI 回复已完成"');
    expect(markup).toContain("text-task-completed");
    expect(markup).toContain("size-2");
    expect(markup).not.toContain("task-status-dot--breathing");
    expect(markup).not.toContain("lucide-");
    expect(markup).not.toContain("task-age");
  });

  it("shows a static red dot when the reply is interrupted", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention="failed"
        isAwaitingApproval={false}
        isRunning={false}
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="AI 回复未完成"');
    expect(markup).toContain("text-task-failed");
    expect(markup).toContain("size-2");
    expect(markup).not.toContain("task-status-dot--breathing");
    expect(markup).not.toContain("lucide-");
    expect(markup).not.toContain("task-age");
  });

  it("keeps showing the task age after the task stops", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention={null}
        isAwaitingApproval={false}
        isRunning={false}
        updatedAt={new Date().toISOString()}
      />,
    );

    expect(markup).toContain("task-age");
    expect(markup).not.toContain('aria-label="任务运行中"');
  });
});
