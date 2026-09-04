import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const webSourceRoot = join(process.cwd(), "apps/web/src");

function readWebSource(path: string): string {
  return readFileSync(join(webSourceRoot, path), "utf8");
}

describe("Workbench 加载边界", () => {
  it("让工作台背景跨 Project 与 Task 子路由保持挂载", () => {
    const workbenchRoute = readWebSource("app/routes/workbench-route.tsx");
    const workbenchShell = readWebSource("features/workbench/components/workbench-shell.tsx");
    const router = readWebSource("app/router.tsx");

    expect(workbenchRoute).toContain("export const workbenchLayoutRoute = createRoute");
    expect(workbenchRoute).toContain("<WorkbenchBackground>");
    expect(workbenchRoute).toContain("<WorkbenchRoute");
    expect(workbenchRoute).not.toContain("<Outlet />");
    expect(workbenchShell).not.toContain("WorkbenchBackground");
    expect(router).toContain("workbenchLayoutRoute.addChildren([");

    for (const routeFile of [
      "project-route.tsx",
      "task-board-route.tsx",
      "task-route.tsx",
      "temporary-route.tsx",
      "temporary-task-route.tsx",
    ]) {
      const source = readWebSource(`app/routes/${routeFile}`);
      expect(source).toContain("getParentRoute: () => workbenchLayoutRoute");
      expect(source).not.toContain("<WorkbenchRoute");
    }
  });

  it("让所有工作台路由复用唯一动态入口", () => {
    const workbenchRoutePath = join(webSourceRoot, "app/routes/workbench-route.tsx");
    expect(existsSync(workbenchRoutePath)).toBe(true);

    const workbenchRoute = readFileSync(workbenchRoutePath, "utf8");
    expect(workbenchRoute).toContain("export function loadWorkbenchShell()");
    expect(workbenchRoute).toContain(
      'import("../../features/workbench/components/workbench-shell.js")',
    );

    for (const routeFile of [
      "project-route.tsx",
      "task-board-route.tsx",
      "task-route.tsx",
      "temporary-route.tsx",
      "temporary-task-route.tsx",
    ]) {
      const source = readWebSource(`app/routes/${routeFile}`);
      expect(source).toContain('from "./workbench-route.js"');
      expect(source).not.toContain(".lazy(");
    }

    for (const oldRouteFile of [
      "project-route.lazy.tsx",
      "task-route.lazy.tsx",
      "temporary-route.lazy.tsx",
      "temporary-task-route.lazy.tsx",
    ]) {
      expect(existsSync(join(webSourceRoot, "app/routes", oldRouteFile))).toBe(false);
    }
  });

  it("只让重型内容和按需设置保留组件级动态加载", () => {
    const layout = readWebSource("features/workbench/components/workbench-shell-layout.tsx");
    const dialogs = readWebSource("features/workbench/components/workbench-shell-dialogs.tsx");
    const commitPanel = readWebSource("features/workbench/components/commit-changes-panel.tsx");
    expect(layout).not.toContain("lazy(");
    expect(commitPanel).not.toContain("lazy(");
    expect(dialogs).toContain("const LazyGlobalSettingsDialog = lazy");
    expect(dialogs).toContain("loadGlobalSettingsDialog()");

    expect(readWebSource("shared/components/agent/lazy-message-response.tsx")).toContain(
      'import("./message-response.js")',
    );
    expect(readWebSource("shared/components/agent/code-block.tsx")).toContain(
      'import("./code-highlighter.js")',
    );
    expect(readWebSource("features/diff/file-diff-panel.tsx")).toContain(
      'lazy(() => import("./patch-diff-viewer.js"))',
    );
    expect(readWebSource("features/diff/file-diff-dialog.tsx")).toContain(
      'lazy(() => import("./patch-diff-viewer.js"))',
    );
  });
});
