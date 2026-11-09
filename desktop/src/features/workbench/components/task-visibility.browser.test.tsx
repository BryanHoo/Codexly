import { Activity, StrictMode } from "react";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { subscribeTaskNotificationsRead } from "@codexly/frontend-core/task-notification-read";
import { useTaskVisibility } from "@codexly/ui/core/use-task-visibility";
import { createProjectRuntimeManager, type ProjectRuntimeManager } from "../../conversation/runtime/project-runtime.js";
import type { NativeRuntimeClient } from "../../projects/project-queries.js";

function Pane({ runtime, taskId }: { runtime: ProjectRuntimeManager; taskId: string }) {
  useTaskVisibility(runtime, "visibility-test", taskId, true);
  return <section aria-label={taskId} style={{ height: 100, overflowY: "auto" }}><div style={{ height: 800 }}>任务正文</div></section>;
}

test("分屏可见时无需点击即已读，Activity 隐藏后新通知保持未读，恢复后自动确认", async () => {
  const runtime = createProjectRuntimeManager({} as NativeRuntimeClient);
  const reads: string[] = [];
  const stop = subscribeTaskNotificationsRead(tasks => { for (const task of tasks) reads.push(task.taskId); });
  const view = (rightVisible: boolean) => <StrictMode>
    <Pane runtime={runtime} taskId="left" />
    <Activity mode={rightVisible ? "visible" : "hidden"}><Pane runtime={runtime} taskId="right" /></Activity>
  </StrictMode>;
  const activity = (taskId: string, status: "completed" | "failed") => ({
    projectId: "visibility-test", taskId, taskName: taskId, status, requiresApproval: false,
  });
  const publish = (tasks: ReturnType<typeof activity>[]) => {
    reads.length = 0;
    runtime.reconcileTaskActivities(tasks, runtime.getTaskActivity());
  };
  const screen = await render(view(true));
  try {
    // 两个窗口均已显示；右窗从未点击或获得键盘焦点。
    publish([activity("left", "completed"), activity("right", "completed")]);
    expect(reads).toEqual(expect.arrayContaining(["left", "right"]));
    const pane = screen.getByRole("region", { name: "right" }).element();
    pane.scrollTop = 100;
    pane.dispatchEvent(new Event("scroll"));
    publish([activity("right", "failed")]);
    expect(reads).toContain("right");
    await screen.rerender(view(false));
    publish([activity("right", "completed")]);
    expect(reads).not.toContain("right");
    await screen.rerender(view(true));
    expect(reads).toContain("right");
    expect(runtime.getTaskActivity().get("visibility-test\u0000right")?.attention).toBeNull();
  } finally {
    await screen.unmount();
    runtime.dispose();
    stop();
  }
});
