import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useWorkbenchComposerController as useWebController } from "../../../../../apps/web/src/features/workbench/hooks/use-workbench-composer-controller.js";
import { useWorkbenchComposerController as useDesktopController } from "./use-workbench-composer-controller.js";

it.each([
  ["Web", useWebController],
  ["桌面", useDesktopController],
] as const)("%s 在发送期间重新渲染时保留占位，仅在结束或卸载时清理", (_platform, useController) => {
  const notify = vi.fn();
  let controller!: ReturnType<typeof useWebController>;
  function Harness({ revision }: Readonly<{ revision: number }>) {
    const [pending, setPending] = useState(false);
    // 与双引擎 Composer 一致，每次渲染传入新的闭包，防止稳定回调掩盖清理竞态。
    const currentController = useController("project:draft", (submitting) => {
      notify(revision, submitting);
      setPending(submitting);
    });
    useLayoutEffect(() => {
      controller = currentController;
    }, [currentController]);
    return pending ? <p>首次发送的消息</p> : null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<Harness revision={1} />));
    flushSync(() => controller.setIsSubmitting(true));
    expect(host.textContent).toBe("首次发送的消息");
    expect(notify.mock.calls).toEqual([[1, true]]);

    const message = host.firstChild;
    flushSync(() => root.render(<Harness revision={2} />));
    expect(host.firstChild).toBe(message);
    expect(host.textContent).toBe("首次发送的消息");
    expect(notify.mock.calls).toEqual([[1, true]]);

    // 真实请求结束仍须同步撤销占位，不能为了避免闪烁而吞掉 false 通知。
    flushSync(() => controller.setIsSubmitting(false));
    expect(host.textContent).toBe("");
    expect(notify.mock.calls).toEqual([[1, true], [2, false]]);
    flushSync(() => controller.setIsSubmitting(true));
    notify.mockClear();
  } finally {
    root.unmount();
    host.remove();
  }
  // 真正卸载使用最新闭包清理，不能通知已经离开的任务或旧窗口。
  expect(notify.mock.calls).toEqual([[2, false]]);
});
