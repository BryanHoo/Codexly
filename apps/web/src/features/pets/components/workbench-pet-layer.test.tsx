import type { WorkbenchPetDescriptor } from "@codexly/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { petCatalogQueryKey } from "../pet-catalog-query.js";
import { WorkbenchPetBubbles } from "./workbench-pet-bubbles.js";
import { WorkbenchPetLayer, WorkbenchPetLayerView } from "./workbench-pet-layer.js";

const pet: WorkbenchPetDescriptor = {
  animations: {
    idle: {
      fallback: "idle",
      frames: [{ durationMs: 150, spriteIndex: 0 }],
      loopStart: 0,
    },
  },
  assetId: "a".repeat(64),
  availability: "ready",
  description: "The Codex desktop pet.",
  displayName: "Codex",
  frame: { columns: 8, height: 208, rows: 9, width: 192 },
  id: "codex",
  source: "builtin",
};

function renderDisabledLayer(): string {
  const queryClient = new QueryClient();
  queryClient.setQueryData(petCatalogQueryKey, { data: [pet] });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <WorkbenchPetLayer settings={{ enabled: false, selectedPetId: null }} />
    </QueryClientProvider>,
  );
}

describe("WorkbenchPetLayer", () => {
  it("关闭时不创建 Overlay 或 Canvas", () => {
    expect(renderDisabledLayer()).toBe("");
  });

  it("开启且资源就绪时只创建一个 Canvas", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchPetLayerView
        activity={{ animationName: "running", tasks: [] }}
        localAccess
        onTaskSelect={() => undefined}
        pet={pet}
      />,
    );
    expect(markup).toContain('class="workbench-pet-layer"');
    expect(markup).toContain('aria-label="移动工作台宠物 Codex"');
    expect(markup).toContain('data-animation="running"');
    expect(markup.match(/<canvas/g)).toHaveLength(1);
  });

  it("按 Task 展示独立气泡并提供独立 aria-live 摘要", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <WorkbenchPetBubbles
          tasks={[
            {
              projectId: "project-1",
              rootPath: "/workspace/Codexly",
              status: "waiting",
              taskId: "task-1",
              taskName: "修复宠物任务气泡",
            },
            {
              projectId: "project-1",
              rootPath: "/workspace/Codexly",
              status: "running",
              taskId: "task-2",
              taskName: "完善堆叠交互",
            },
            {
              projectId: "project-1",
              rootPath: "/workspace/Codexly",
              status: "completed",
              taskId: "task-3",
              taskName: "完成后台构建",
            },
          ]}
          localAccess
          onTaskSelect={() => undefined}
          placement="above"
        />
      </TooltipProvider>,
    );
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("修复宠物任务气泡");
    expect(markup).toContain("完善堆叠交互");
    expect(markup).toContain("完成后台构建");
    expect(markup).not.toContain(">Codexly<");
    expect(markup.match(/workbench-pet-bubble-item/g)).toHaveLength(3);
    expect(markup.match(/<button/g)).toHaveLength(3);
    expect(markup).toContain('aria-label="打开任务 修复宠物任务气泡，任务等待处理"');
    expect(markup).toContain('aria-label="打开任务 完成后台构建，任务已完成"');
    expect(markup).toContain("lucide-circle-check");
    expect(markup).toContain("text-task-completed");
    expect(markup).toMatch(
      /<li class="workbench-pet-bubble-item" style="z-index:3"><button aria-label="打开任务 完成后台构建，任务已完成"/u,
    );
    expect(markup).toContain('data-placement="above"');
  });

  it("气泡默认堆叠，悬停或聚焦宠物区域时展开", () => {
    const css = readFileSync(
      new URL("../../../shared/styles/workbench.css", import.meta.url),
      "utf8",
    );
    const rule = /\.workbench-pet-bubbles\s*\{(?<body>[^}]*)\}/u.exec(css)?.groups?.["body"] ?? "";

    expect(rule).toMatch(/(?:^|\n)\s*width:\s*max-content;/u);
    expect(rule).toContain("max-width: min(12rem, calc(100vw - 32px));");
    expect(css).toContain(
      ".workbench-pet-bubble-item + .workbench-pet-bubble-item {\n  margin-top: calc(var(--workbench-pet-bubble-height) * -0.6667);",
    );
    expect(css).toContain(".workbench-pet-positioner:hover .workbench-pet-bubble-item");
    expect(css).toContain(".workbench-pet-positioner:focus-within .workbench-pet-bubble-item");
  });
});
