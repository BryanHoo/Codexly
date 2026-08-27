import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { requestNextProjectTaskPage } from "../../projects/project-context.js";
import {
  deriveProjectSidebarConnectionState,
  getProjectTaskPaginationControl,
  getProjectSidebarConnectionStatus,
  groupTasksByProjectId,
  ProjectPickerButton,
  ProductBrand,
  SidebarSettingsButton,
  getTaskRoute,
} from "./project-sidebar.js";
import { TemporaryTasksHeading } from "./temporary-tasks-heading.js";

describe("ProductBrand", () => {
  it("renders the complete brand logo asset", () => {
    const markup = renderToStaticMarkup(<ProductBrand />);

    expect(markup).toContain('src="/brand/codexly-logo.svg"');
    expect(markup).toContain('alt="Codexly"');
    expect(markup).not.toContain(">CA<");
  });
});

describe("Project task pagination", () => {
  it("offers a new task icon beside temporary tasks", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <TemporaryTasksHeading
          expanded
          onCreate={vi.fn()}
          onOpenArchived={vi.fn()}
          onToggle={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain("临时任务");
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="新建任务"');
    expect(markup).toContain("lucide-plus");
  });

  it("keeps temporary task navigation outside Project routes", () => {
    expect(getTaskRoute("temporary", "task-1")).toEqual({
      params: { taskId: "task-1" },
      to: "/temporary/t/$taskId",
    });
    expect(getTaskRoute("project-1", "task-1")).toEqual({
      params: { projectId: "project-1", taskId: "task-1" },
      to: "/p/$projectId/t/$taskId",
    });
  });

  it("groups a large task list by Project while preserving task order", () => {
    const tasks = Array.from({ length: 300 }, (_, index) => ({
      id: `task-${String(index)}`,
      pinned: false,
      projectId: `project-${String(index % 3)}`,
      title: `Task ${String(index)}`,
      updatedAt: "2026-07-23T00:01:00.000Z",
    }));

    const tasksByProjectId = groupTasksByProjectId(tasks);

    expect(tasksByProjectId.get("project-0")).toHaveLength(100);
    expect(
      tasksByProjectId
        .get("project-0")
        ?.map((task) => task.id)
        .slice(0, 3),
    ).toEqual(["task-0", "task-3", "task-6"]);
    expect(tasksByProjectId.get("project-2")?.at(-1)?.id).toBe("task-299");
    expect(tasksByProjectId.get("missing-project")).toBeUndefined();
  });

  it("requests only the selected Project next page", async () => {
    const fetchFirstProjectNextPage = vi.fn(() => Promise.resolve());
    const fetchSecondProjectNextPage = vi.fn(() => Promise.resolve());
    const projectTaskControllers = new Map([
      ["project-1", { fetchNextPage: fetchFirstProjectNextPage }],
      ["project-2", { fetchNextPage: fetchSecondProjectNextPage }],
    ]);

    await requestNextProjectTaskPage(projectTaskControllers, "project-2");

    expect(fetchFirstProjectNextPage).not.toHaveBeenCalled();
    expect(fetchSecondProjectNextPage).toHaveBeenCalledOnce();
  });

  it("ignores a next-page request for an unavailable Project", async () => {
    await expect(requestNextProjectTaskPage(new Map(), "missing-project")).resolves.toBeUndefined();
  });

  it("separates local expansion, remote loading, retry, and collapse actions", () => {
    expect(
      getProjectTaskPaginationControl({
        error: null,
        hasHiddenLoadedTasks: false,
        hasNextPage: true,
        isExpanded: false,
        isFetchingNextPage: false,
      }),
    ).toEqual({ action: "expand-and-load", disabled: false, label: "显示更多" });
    expect(
      getProjectTaskPaginationControl({
        error: null,
        hasHiddenLoadedTasks: true,
        hasNextPage: true,
        isExpanded: false,
        isFetchingNextPage: false,
      }),
    ).toEqual({ action: "expand-and-load", disabled: false, label: "显示更多" });
    expect(
      getProjectTaskPaginationControl({
        error: null,
        hasHiddenLoadedTasks: false,
        hasNextPage: true,
        isExpanded: true,
        isFetchingNextPage: true,
      }),
    ).toEqual({ action: "load", disabled: true, label: "正在加载更多" });
    expect(
      getProjectTaskPaginationControl({
        error: new Error("network"),
        hasHiddenLoadedTasks: false,
        hasNextPage: true,
        isExpanded: true,
        isFetchingNextPage: false,
      }),
    ).toEqual({ action: "load", disabled: false, label: "重试加载更多" });
    expect(
      getProjectTaskPaginationControl({
        error: null,
        hasHiddenLoadedTasks: true,
        hasNextPage: false,
        isExpanded: true,
        isFetchingNextPage: false,
      }),
    ).toEqual({ action: "collapse", disabled: false, label: "收起" });
  });
});

describe("ProjectSidebar connection status", () => {
  it("uses the active task terminal connection state", () => {
    for (const connectionState of ["closed", "connected", "connecting", "reconnecting"] as const) {
      expect(
        deriveProjectSidebarConnectionState({
          hasActiveTask: true,
          projectDataFailed: true,
          projectDataPending: true,
          taskConnectionState: connectionState,
        }),
      ).toBe(connectionState);
    }
  });

  it("derives an HTTP runtime status before a task terminal exists", () => {
    expect(
      deriveProjectSidebarConnectionState({
        hasActiveTask: false,
        projectDataFailed: false,
        projectDataPending: true,
        taskConnectionState: "connecting",
      }),
    ).toBe("connecting");
    expect(
      deriveProjectSidebarConnectionState({
        hasActiveTask: false,
        projectDataFailed: false,
        projectDataPending: false,
        taskConnectionState: "connecting",
      }),
    ).toBe("connected");
    expect(
      deriveProjectSidebarConnectionState({
        hasActiveTask: false,
        projectDataFailed: true,
        projectDataPending: false,
        taskConnectionState: "connecting",
      }),
    ).toBe("closed");
  });

  it("maps every transport state to a visible status", () => {
    expect(getProjectSidebarConnectionStatus("connected")).toEqual({
      labelKey: "sidebar.connection.online",
      toneClassName: "text-diff-added",
    });
    expect(getProjectSidebarConnectionStatus("connecting")).toEqual({
      labelKey: "sidebar.connection.connecting",
      toneClassName: "text-warning",
    });
    expect(getProjectSidebarConnectionStatus("reconnecting")).toEqual({
      labelKey: "sidebar.connection.reconnecting",
      toneClassName: "text-warning",
    });
    expect(getProjectSidebarConnectionStatus("closed")).toEqual({
      labelKey: "sidebar.connection.offline",
      toneClassName: "text-danger",
    });
  });
});

describe("ProjectPickerButton", () => {
  it("opens the Web directory picker without exposing native picker state", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ProjectPickerButton disabled={false} onOpen={vi.fn()} />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="添加项目"');
    expect(markup).toContain('data-size="icon-sm"');
    expect(markup).not.toContain("LoaderCircle");
  });
});

describe("SidebarSettingsButton", () => {
  const appInfo = {
    appVersion: "1.3.0",
    codexVersion: "0.149.0",
    latestVersion: "1.3.0",
    releaseNotes: null,
    status: "current" as const,
    updateAvailable: false,
  };

  it("renders every connection status in Chinese", async () => {
    await changeAppLanguage("zh-CN");
    const cases = [
      ["connected", "在线"],
      ["connecting", "正在连接"],
      ["reconnecting", "正在重新连接"],
      ["closed", "离线"],
    ] as const;

    for (const [connectionState, label] of cases) {
      const markup = renderToStaticMarkup(
        <SidebarSettingsButton
          appInfo={appInfo}
          connectionState={connectionState}
          onOpen={vi.fn()}
        />,
      );
      expect(markup).toContain(`Codexly 1.3.0，终端连接状态：${label}`);
      expect(markup).toContain("v1.3.0");
      expect(markup).toContain(`>${label}</span>`);
      expect(markup).not.toContain("href=");
    }
  });

  it("renders every connection status in English", async () => {
    await changeAppLanguage("en");
    try {
      const cases = [
        ["connected", "Online"],
        ["connecting", "Connecting"],
        ["reconnecting", "Reconnecting"],
        ["closed", "Offline"],
      ] as const;

      for (const [connectionState, label] of cases) {
        const markup = renderToStaticMarkup(
          <SidebarSettingsButton
            appInfo={appInfo}
            connectionState={connectionState}
            onOpen={vi.fn()}
          />,
        );
        expect(markup).toContain(`Codexly 1.3.0, terminal connection status: ${label}`);
        expect(markup).toContain(`>${label}</span>`);
      }
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });

  it("uses a distinct version state when an update is available", async () => {
    await changeAppLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <SidebarSettingsButton
        appInfo={{
          ...appInfo,
          latestVersion: "1.4.0",
          releaseNotes: "### 新增\n\n- 添加更新日志。",
          status: "available",
          updateAvailable: true,
        }}
        connectionState="connected"
        onOpen={vi.fn()}
      />,
    );

    expect(markup).toContain("Codexly 1.3.0，有可用更新，终端连接状态：在线");
    expect(markup).toContain("lucide-circle-arrow-up");
    expect(markup).toContain('class="text-warning"');
  });
});
