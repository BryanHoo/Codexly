import type { ScheduledTask } from "@/protocol/index.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

vi.mock("../workbench/components/workbench-composer.js", async () => {
  const { useEffect, useImperativeHandle, useState } = await import("react");
  return {
    WorkbenchComposer: (props: {
      captureSubmitVisible?: boolean;
      composerRef?: React.Ref<unknown>;
      footerVisible?: boolean;
      initialDraft?: {
        attachments: readonly unknown[];
        content: readonly unknown[];
      };
      onCaptureSubmission?: (
        prompt: ScheduledTask["prompt"],
        turnOptions: ScheduledTask["turnOptions"],
        attachments: readonly [],
      ) => Promise<void>;
      onInputStateChange?: (hasInput: boolean) => void;
      settings: ScheduledTask["turnOptions"];
    }) => {
      const { onInputStateChange } = props;
      const [hasInput, setHasInput] = useState(
        (props.initialDraft?.attachments.length ?? 0) > 0 ||
          (props.initialDraft?.content.length ?? 0) > 0,
      );
      useEffect(() => onInputStateChange?.(hasInput), [hasInput, onInputStateChange]);
      useImperativeHandle(props.composerRef, () => ({
        submitCurrent: async () => {
          try {
            await props.onCaptureSubmission?.(
              { attachments: [], skills: [], text: "Review", type: "prompt" },
              props.settings,
              [],
            );
            return true;
          } catch (error) {
            // 模拟真实 Composer 对捕获模式错误的唯一通知职责。
            const { notifyActionError } = await import("../notifications/action-notifications.js");
            notifyActionError(error);
            return false;
          }
        },
      }));
      return (
        <div
          data-capture-submit-visible={String(props.captureSubmitVisible)}
          data-footer-visible={String(props.footerVisible)}
        >
          <button onClick={() => setHasInput(true)} type="button">
            填写测试提示词
          </button>
        </div>
      );
    },
  };
});

import "../../shared/styles/globals.css";
import "../../shared/styles/scheduled-tasks.css";
import { createActionMutationCache } from "../notifications/action-notifications.js";
import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import {
  TauriSidebarClient,
  type InvokeImplementation,
} from "../../platform/tauri/sidebar-client.js";
import { ScheduledTaskEditor } from "./scheduled-task-editor.js";
import { ScheduledTaskList } from "./scheduled-task-list.js";
import { ScheduledTasksContainer } from "./scheduled-tasks-container.js";

const previewSchedule = async () => ({ dates: [2_000_000_000_000] });

const task: ScheduledTask = {
  createdAtUnixMs: 1,
  enabled: true,
  id: "schedule-a",
  lastRunAtUnixMs: 2,
  lastRunStatus: "failed",
  name: "每日巡检",
  nextRunAtUnixMs: 2_000_000_000_000,
  projectId: "project-a",
  projectName: "Project A",
  prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
  runs: [],
  schedule: { atUnixMs: 2_000_000_000_000, type: "once" },
  turnOptions: {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  updatedAtUnixMs: 2,
};

describe("ScheduledTaskList", () => {
  it("previews recurring times and blocks save until the matching response arrives", async () => {
    await i18n.changeLanguage("zh-CN");
    const onPreview = vi.fn(async () => ({ dates: [2_000_000_000_000, 2_000_086_400_000, 2_000_172_800_000, 2_000_259_200_000, 2_000_345_600_000] }));
    const screen = await render(<I18nextProvider i18n={i18n}>
      <ScheduledTaskEditor composerProps={{ settings: task.turnOptions } as never} onPreview={onPreview}
        onOpenRun={vi.fn()} onProjectChange={vi.fn()} onRunNow={vi.fn()} onSave={vi.fn()}
        projectId={task.projectId} projects={[]} skills={[]} task={task} />
    </I18nextProvider>);
    await screen.getByRole("combobox", { name: "重复规则" }).selectOptions("daily");
    await expect.poll(() => onPreview.mock.calls.length).toBe(1);
    await expect.poll(() => screen.container.querySelectorAll(".scheduled-task-preview li").length).toBe(3);
    await screen.getByRole("button", { name: "展开 5 次" }).click();
    await expect.poll(() => screen.container.querySelectorAll(".scheduled-task-preview li").length).toBe(5);
    await screen.getByRole("textbox", { name: "任务名称" }).fill("新的名称");
    expect(onPreview).toHaveBeenCalledTimes(1);
  });
  it("opens only on click and keeps a compact menu with delete confirmation", async () => {
    await i18n.changeLanguage("zh-CN");
    const onDelete = vi.fn();
    const onEnabledChange = vi.fn();
    const screen = await render(<I18nextProvider i18n={i18n}>
      <ScheduledTaskList onDelete={onDelete} loading={false} onCreate={vi.fn()}
        onEnabledChange={onEnabledChange} onSelect={vi.fn()} query="" setQuery={vi.fn()}
        tasks={[{ ...task, enabled: false }]} />
    </I18nextProvider>);
    const trigger = screen.getByRole("button", { name: "每日巡检操作" });
    expect(screen.container.querySelector('[role="switch"]')).toBeNull();
    await trigger.hover();
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    await trigger.click();
    expect(page.getByRole("menu").element().getBoundingClientRect().width).toBeLessThanOrEqual(132);
    await page.getByRole("menuitem", { name: "启用每日巡检" }).click();
    expect(onEnabledChange).toHaveBeenCalledWith(task.id, true);
    await trigger.click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    expect(onDelete).not.toHaveBeenCalled();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await trigger.click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(task.id);
  });

  it.each([1280, 1920])("keeps the split panel within desktop bounds at %i", async (width) => {
    await page.viewport(width, 900);
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <div className="scheduled-tasks" style={{ height: 850, width: width - 240 }}>
          <ScheduledTaskList onDelete={vi.fn()} activeId={task.id} loading={false} onCreate={vi.fn()} onEnabledChange={vi.fn()}
            onSelect={vi.fn()} query="" setQuery={vi.fn()}
            tasks={[task, { ...task, id: "paused", name: "每周回顾", enabled: false }]} />
          <ScheduledTaskEditor onPreview={previewSchedule} composerProps={{ settings: task.turnOptions } as never}
            onOpenRun={vi.fn()} onProjectChange={vi.fn()}
            onRunNow={async () => undefined} onSave={async () => undefined}
            projectId={task.projectId} projects={[]} skills={[]} task={task} />
        </div>
      </I18nextProvider>,
    );
    const panel = screen.container.querySelector<HTMLElement>(".scheduled-tasks")!;
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    const prompt = screen.container.querySelector(".scheduled-task-prompt")!.getBoundingClientRect();
    const details = screen.container.querySelector(".scheduled-task-section")!.getBoundingClientRect();
    expect(prompt.bottom).toBeLessThan(details.top);
    const titleStyle = getComputedStyle(screen.getByRole("textbox", { name: "任务名称" }).element());
    expect(titleStyle.borderTopWidth).toBe("1px");
    expect(titleStyle.borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(screen.getByRole("combobox", { name: "重复规则" }).element()).textAlignLast).toBe("right");
    for (const control of screen.container.querySelectorAll("input, select")) {
      expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
    }
    await page.viewport(1440, 900);
  });

  it("filters enabled and paused tasks without losing selection actions", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskList onDelete={vi.fn()} loading={false} onCreate={vi.fn()} onEnabledChange={vi.fn()}
          onSelect={vi.fn()} query="" setQuery={vi.fn()}
          tasks={[task, { ...task, id: "paused", name: "每周回顾", enabled: false }]} />
      </I18nextProvider>,
    );
    await screen.getByRole("button", { name: "已暂停", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "每日巡检", exact: true })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "每周回顾", exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "已启用", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "每日巡检", exact: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "每周回顾", exact: true })).not.toBeInTheDocument();
  });

  it("renders search and an icon-only create action in the list header", async () => {
    await i18n.changeLanguage("zh-CN");
    const onCreate = vi.fn();
    const onEnabledChange = vi.fn();
    const onSelect = vi.fn();
    const setQuery = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskList onDelete={vi.fn()}
          activeId="schedule-a"
          loading={false}
          onCreate={onCreate}
          onEnabledChange={onEnabledChange}
          onSelect={onSelect}
          query="巡检"
          setQuery={setQuery}
          tasks={[task]}
        />
      </I18nextProvider>,
    );

    await expect.element(screen.getByRole("heading", { name: "定时任务" })).toBeVisible();
    expect(
      screen.container.querySelector(".scheduled-task-list__header span")?.textContent,
    ).toBe("1");
    await expect.element(screen.getByText("每日巡检")).toBeVisible();
    expect(screen.container.querySelector("[data-tone='failed']")).not.toBeNull();
    await screen.getByRole("searchbox", { name: "搜索定时任务" }).fill("日报");
    const createButton = screen.getByRole("button", { name: "新建定时任务" });
    expect(createButton.element().textContent).toBe("");
    expect(createButton.element().querySelector("svg")).not.toBeNull();
    expect(createButton.element().getAttribute("data-size")).toBe("icon-toolbar");
    expect(createButton.element().getAttribute("data-variant")).toBe("default");
    await createButton.click();
    await screen.getByRole("button", { name: "每日巡检", exact: true }).click();
    await screen.getByRole("button", { name: "每日巡检操作" }).click();
    await page.getByRole("menuitem", { name: "停用每日巡检" }).click();
    expect(setQuery).toHaveBeenLastCalledWith("日报");
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(task);
    expect(onEnabledChange).toHaveBeenCalledWith("schedule-a", false);
  });

  it("uses an explicit editor save button and hides composer submission chrome", async () => {
    await i18n.changeLanguage("zh-CN");
    const onSave = vi.fn(async () => undefined);
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor onPreview={previewSchedule}
          composerProps={{ settings: task.turnOptions } as never}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={onSave}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
          task={task}
        />
      </I18nextProvider>,
    );

    expect(screen.container.querySelector("[data-capture-submit-visible='false']")).not.toBeNull();
    expect(screen.container.querySelector("[data-footer-visible='false']")).not.toBeNull();
    const prompt = screen.container.querySelector<HTMLElement>(".scheduled-task-prompt");
    expect(prompt).not.toBeNull();
    expect(getComputedStyle(prompt!).borderBottomWidth).toBe("0px");
    await screen.getByRole("button", { name: "保存任务" }).click();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("disables save until required fields and composer input are complete", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor onPreview={previewSchedule}
          composerProps={{ settings: task.turnOptions } as never}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={async () => undefined}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
        />
      </I18nextProvider>,
    );

    const save = screen.getByRole("button", { name: "保存任务" });
    await expect.element(save).toBeDisabled();
    await screen.getByRole("textbox", { name: "任务名称" }).fill("每日巡检");
    await expect.element(save).toBeDisabled();
    await screen.getByRole("button", { name: "填写测试提示词" }).click();
    await expect.element(save).toBeEnabled();
  });

  it("separates run, save, and destructive delete actions", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor onPreview={previewSchedule}
          composerProps={{ settings: task.turnOptions } as never}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={async () => undefined}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
          task={task}
        />
      </I18nextProvider>,
    );

    const toolbar = screen.container.querySelector(".scheduled-task-editor__toolbar");
    const dangerZone = screen.container.querySelector(".scheduled-task-danger-zone");
    expect(toolbar?.querySelector("[aria-label='立即运行']")).not.toBeNull();
    expect(toolbar?.querySelector("[aria-label='保存任务']")).not.toBeNull();
    expect(toolbar?.querySelector("[aria-label='删除']")).toBeNull();
    expect(dangerZone).toBeNull();
  });

  it("keeps the repeat field fixed when the date picker opens", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor onPreview={previewSchedule}
          composerProps={{ settings: task.turnOptions } as never}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={async () => undefined}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
          task={task}
        />
      </I18nextProvider>,
    );

    const repeat = screen.getByRole("combobox", { name: "重复规则" });
    const topBeforeOpen = repeat.element().getBoundingClientRect().top;
    await screen.getByRole("textbox", { name: "触发时间" }).click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    const topAfterOpen = repeat.element().getBoundingClientRect().top;

    expect(Math.abs(topAfterOpen - topBeforeOpen)).toBeLessThan(1);
  });

  it.each([1280, 1920])("links recurrence controls and saves at desktop width %i", async (width) => {
    await page.viewport(width, 720);
    await i18n.changeLanguage("zh-CN");
    const onSave = vi.fn(async () => undefined);
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor onPreview={previewSchedule}
          composerProps={{ settings: task.turnOptions } as never}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={onSave}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
          task={task}
        />
      </I18nextProvider>,
    );
    const repeat = screen.getByRole("combobox", { name: "重复规则" });
    await expect.element(screen.getByRole("textbox", { name: "触发时间" })).toBeVisible();
    await repeat.selectOptions("weekly");
    await expect.element(screen.getByRole("textbox", { name: "触发时间" })).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "周五", exact: true }).click();
    expect(screen.getByRole("button", { name: "周五", exact: true }).element().getBoundingClientRect().top)
      .toBeLessThan(screen.getByLabelText("时间", { exact: true }).element().getBoundingClientRect().top);
    const timeInput = screen.getByLabelText("时间", { exact: true });
    const initialBackground = getComputedStyle(timeInput.element()).backgroundColor;
    await timeInput.hover();
    expect(getComputedStyle(timeInput.element()).cursor).toBe("pointer");
    expect(getComputedStyle(timeInput.element()).backgroundColor).toBe(initialBackground);
    await screen.getByLabelText("时间", { exact: true }).fill("");
    await expect.element(screen.getByRole("button", { name: "保存任务" })).toBeDisabled();
    await screen.getByLabelText("时间", { exact: true }).fill("17:45");
    await screen.getByRole("button", { name: "保存任务" }).click();
    expect(onSave).toHaveBeenLastCalledWith(task.id, expect.objectContaining({
      schedule: expect.objectContaining({ rrule: expect.stringContaining("BYHOUR=17;BYMINUTE=45;BYSECOND=0") }),
    }));
    await repeat.selectOptions("monthly");
    await expect.element(screen.getByRole("button", { name: "周五", exact: true })).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "31", exact: true }).click();
    expect(screen.getByRole("button", { name: "31", exact: true }).element().getBoundingClientRect().top)
      .toBeLessThan(screen.getByLabelText("时间", { exact: true }).element().getBoundingClientRect().top);
    const controls = [...screen.container.querySelectorAll(".scheduled-task-fields input, .scheduled-task-fields select")];
    for (const control of controls) {
      const bounds = control.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    await screen.getByRole("button", { name: "保存任务" }).click();
    expect(onSave).toHaveBeenLastCalledWith(task.id, expect.objectContaining({
      schedule: expect.objectContaining({ rrule: expect.stringContaining("BYHOUR=17;BYMINUTE=45;BYSECOND=0") }),
    }));
    for (const preset of ["daily", "weekdays"]) {
      await repeat.selectOptions(preset);
      await expect.element(screen.getByLabelText("时间", { exact: true })).toHaveValue("17:45");
      await expect.element(screen.getByRole("button", { name: "31", exact: true })).not.toBeInTheDocument();
      await expect.element(screen.getByRole("textbox", { name: "触发时间" })).not.toBeInTheDocument();
    }
    await repeat.selectOptions("weekly");
    await expect.element(screen.getByRole("button", { name: "周五", exact: true })).toHaveAttribute("aria-pressed", "true");
    await repeat.selectOptions("once");
    await expect.element(screen.getByRole("textbox", { name: "触发时间" })).toBeVisible();
    await expect.element(screen.getByLabelText("时间", { exact: true })).not.toBeInTheDocument();
    await repeat.selectOptions("custom");
    await expect.element(screen.getByRole("spinbutton", { name: "重复间隔" })).toBeVisible();
    await page.viewport(1440, 900);
  });

  it("restores weekly fields and preserves the task timezone on save", async () => {
    await i18n.changeLanguage("zh-CN");
    const onSave = vi.fn(async () => undefined);
    const schedule = {
      type: "rrule" as const,
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=45",
      startAtUnixMs: new Date(2030, 0, 2, 8).getTime(),
      timezone: "America/New_York",
    };
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor onPreview={previewSchedule}
          composerProps={{ settings: task.turnOptions } as never}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={onSave}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
          task={{ ...task, schedule }}
        />
      </I18nextProvider>,
    );
    await expect.element(screen.getByRole("button", { name: "周五", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByLabelText("时间", { exact: true })).toHaveValue("17:45");
    await screen.getByRole("button", { name: "保存任务" }).click();
    expect(onSave).toHaveBeenLastCalledWith(task.id, expect.objectContaining({
      schedule: expect.objectContaining({ rrule: "RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=FR;BYHOUR=17;BYMINUTE=45;BYSECOND=0", timezone: schedule.timezone }),
    }));
  });

  it("shows one error toast when saving through the composer fails", async () => {
    await i18n.changeLanguage("zh-CN");
    const nativeMessage = "invalid args `input`: missing field `atUnixMs`";
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_scheduled_tasks") return { data: [] };
      return Promise.reject(nativeMessage);
    });
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const queryClient = new QueryClient({ mutationCache: createActionMutationCache() });
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ScheduledTasksContainer
            context={{
              client,
              draftSettings: task.turnOptions,
              fastModeAvailable: false,
              fastModeDefault: false,
              gitStatusQuery: {},
              models: [],
              modelsQuery: { isPending: false },
              navigate: vi.fn(),
              openProjectFolder: vi.fn(),
              projectFolderOpenDisabled: false,
              projectName: "Project A",
              projectPath: "/project-a",
              projectRoots: [],
              projects: [],
              setSelectedRootId: vi.fn(),
              skillsQuery: {},
              t: i18n.t,
            } as never}
            projectId="project-a"
            temporary={false}
          />
          <Toaster />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    await screen.getByRole("button", { name: "新建定时任务" }).click();
    await screen.getByRole("textbox", { name: "任务名称" }).fill("每日巡检");
    await screen.getByRole("button", { name: "填写测试提示词" }).click();
    await screen.getByRole("button", { name: "保存任务" }).click();
    await expect.element(screen.getByText(nativeMessage)).toBeVisible();
    expect(screen.container.querySelectorAll("[data-sonner-toast]")).toHaveLength(1);
  });
});
