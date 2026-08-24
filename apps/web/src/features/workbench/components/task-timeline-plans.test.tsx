import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { TaskSnapshotTimeline } from "./task-timeline.js";
import { renderToStaticMarkup, completedTurn, snapshot } from "./task-timeline.test-support.js";

describe("task timeline plans and activity", () => {
  it("renders the active plan as a streaming, expanded Plan", () => {
    const planText = "1. 保留原始文本\n2. 接入 Plan 组件";
    const runningPlanSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [{ id: "plan-active", text: planText, type: "plan" }],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline
        onBuildPlan={() => Promise.resolve(true)}
        snapshot={runningPlanSnapshot}
      />,
    );

    expect(markup).toContain('data-ai-plan=""');
    expect(markup).toContain('data-streaming="true"');
    expect(markup).toMatch(/<details[^>]* open/);
    expect(markup).toContain("正在生成计划");
    expect(markup).not.toContain('data-streamdown="ordered-list"');
    expect(markup).toContain("1. 保留原始文本\n2. 接入 Plan 组件");
    expect(markup).not.toContain(">构建<");
    expect(markup).not.toContain("lucide-wrench");
  });

  it("renders a completed plan as an actionable 项目 Agent 组件 card", () => {
    const planText = "# 实施计划\n\n- 保留 `Protocol`";
    const completedPlanSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [{ id: "plan-completed", text: planText, type: "plan" }],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline
        onBuildPlan={() => Promise.resolve(true)}
        snapshot={completedPlanSnapshot}
      />,
    );

    expect(markup).toContain('data-ai-plan=""');
    expect(markup).toContain('data-ai-plan-card=""');
    expect(markup).toContain('data-streaming="false"');
    expect(markup).toContain("计划已生成，可开始构建");
    expect(markup).not.toContain("<h1");
    expect(markup).toContain("# 实施计划");
    expect(markup).toContain("- 保留 `Protocol`");
    expect(markup).toContain(">构建<");
    expect(markup).not.toContain("lucide-wrench");
  });

  it("renders activity items with compact and expandable 项目 Agent 组件 Tasks", () => {
    const activitySnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "activity-compact",
              label: "上下文压缩",
              status: "completed",
              type: "activity",
            },
            {
              detail: "/workspace/apps/web/src/App.tsx",
              id: "activity-detailed",
              label: "查看图片",
              status: "running",
              type: "activity",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={activitySnapshot} />);

    expect(markup.match(/data-ai-task=""/g)).toHaveLength(2);
    expect(markup).toContain('data-status="completed"');
    expect(markup).toContain('data-status="in_progress"');
    expect(markup).toContain("上下文压缩");
    expect(markup).toContain("查看图片");
    expect(markup).toContain("/workspace/apps/web/src/App.tsx");
    expect(markup.match(/<details/g)).toHaveLength(1);
    expect(markup).not.toContain("lucide-wrench");
  });

  it("maps failed and pending activity statuses to 项目 Agent 组件 Task statuses", () => {
    const activitySnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "activity-failed",
              label: "进入审查",
              status: "failed",
              type: "activity",
            },
            {
              id: "activity-pending",
              label: "子任务活动",
              status: "pending",
              type: "activity",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={activitySnapshot} />);

    expect(markup).toContain('data-status="error"');
    expect(markup).toContain('data-status="pending"');
  });

  it("keeps structured subagent calls as simple non-interactive timeline statuses", () => {
    const subagentSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "collaboration-spawn",
              input: {
                model: "gpt-5.6-sol",
                prompt: "理解前端项目",
                reasoningEffort: "high",
                receiverTaskIds: ["child-frontend"],
                senderTaskId: "task-1",
              },
              name: "agent/spawn",
              output: {
                agents: [
                  {
                    message: "前端由 React 工作台与类型安全 Client 组成。",
                    status: "completed",
                    taskId: "child-frontend",
                  },
                ],
              },
              status: "completed",
              type: "tool",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={subagentSnapshot} />);

    expect(markup.match(/data-ai-task=""/g)).toHaveLength(1);
    expect(markup).toContain("启动子代理");
    expect(markup).toContain("1 个子代理已完成");
    expect(markup).not.toContain("子代理 child-frontend");
    expect(markup).not.toContain("理解前端项目");
    expect(markup).not.toContain("GPT-5.6-Sol");
    expect(markup).not.toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain('aria-label="打开子代理 child-frontend 的实时输出"');
    expect(markup).not.toContain("前端由 React 工作台与类型安全 Client 组成。");
    expect(markup).not.toContain("agent/spawn");
    expect(markup).not.toContain("receiverTaskIds");
    expect(markup).not.toContain('data-ai-tool=""');
  });

  it("renders each changed file with its operation and diff statistics", () => {
    const browserCrypto = globalThis.crypto;
    // 局域网 HTTP 页面保留 getRandomValues，但不会暴露仅限安全上下文的 randomUUID。
    vi.stubGlobal("crypto", {
      getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto),
    });
    const fileChangeSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              changes: [
                {
                  diff: "--- a/package.json\n+++ b/package.json\n@@ -1,2 +1,10 @@\n-old\n+new\n+next",
                  kind: "update",
                  path: "/workspace/package.json",
                },
                {
                  diff: "--- /dev/null\n+++ b/docs/runtime-lifecycle.md\n@@ -0,0 +1,2 @@\n+# Runtime lifecycle\n+Details",
                  kind: "create",
                  path: "/workspace/docs/runtime-lifecycle.md",
                },
              ],
              id: "file-change-1",
              status: "completed",
              type: "file_change",
            },
          ],
        },
      ],
    };

    let markup: string;
    try {
      markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={fileChangeSnapshot} />);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(markup).toContain("已编辑 2 个文件");
    expect(markup).toContain('aria-label="本次修改了 2 个文件"');
    expect(markup).toContain(">审核<");
    expect(markup).toContain("已编辑");
    expect(markup).toContain("package.json");
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain("打开 Diff");
    expect(markup).toContain('text-diff-added">+2</span>');
    expect(markup).toContain('text-diff-removed">-1</span>');
    expect(markup).toContain("已创建");
    expect(markup).toContain("runtime-lifecycle.md");
    expect(markup).toContain("已创建 runtime-lifecycle.md，新增 2 行，删除 0 行");
    expect(markup).toContain('text-diff-added">+2</span>');
    expect(markup).toContain('text-diff-removed">-0</span>');
    expect(markup).not.toContain(">文件变更<");
    expect(markup).not.toContain("@@ -1,2 +1,10 @@");
  });
});
