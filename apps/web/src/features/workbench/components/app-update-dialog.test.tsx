import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ButtonModule from "@codexly/ui/core/button";
import { AppUpdateDialog } from "@codexly/ui/core/app-update-dialog";

const actions = vi.hoisted(() => ({ update: undefined as (() => void) | undefined }));
vi.mock("@codexly/ui/core/button", async (original) => {
  const { Button } = await original<typeof ButtonModule>();
  return {
    Button: (props: ComponentProps<typeof Button>) => {
      if (props.children && !props["aria-label"] && props.onClick) {
        actions.update = () => props.onClick?.({} as never);
      }
      return <Button {...props} />;
    },
  };
});

const labels = {
  title: "1.4.0 更新日志",
  close: "关闭更新日志",
  update: "更新",
  updating: "正在更新",
  completed: "更新完成",
  failed: "更新失败，请重试",
  progress: "更新进度",
};

function renderDialog(props: Partial<ComponentProps<typeof AppUpdateDialog>> = {}) {
  return renderToStaticMarkup(
    <AppUpdateDialog labels={labels} onClose={vi.fn()} onUpdate={vi.fn()} {...props}>
      <p>添加侧栏更新日志弹窗。</p>
    </AppUpdateDialog>,
  );
}

describe("更新日志弹窗", () => {
  beforeEach(() => {
    actions.update = undefined;
  });

  it("展示日志，只有点击更新才安装，并阻止同一帧内重复提交", async () => {
    let finish: (() => void) | undefined;
    const request = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onUpdate = vi.fn(() => request);
    const markup = renderDialog({ onUpdate });
    expect(markup).toContain("添加侧栏更新日志弹窗。");
    expect(markup).toContain("1.4.0 更新日志");
    expect(onUpdate).not.toHaveBeenCalled();
    actions.update?.();
    actions.update?.();
    expect(onUpdate).toHaveBeenCalledOnce();
    finish?.();
    await request;
  });

  it("安装失败后释放点击锁，允许重试", async () => {
    const failure = Promise.reject(new Error("安装失败"));
    const onUpdate = vi.fn().mockReturnValueOnce(failure).mockResolvedValueOnce(undefined);
    renderDialog({ onUpdate });
    actions.update?.();
    await failure.catch(() => undefined);
    actions.update?.();
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("已有安装任务时禁用安装与关闭按钮，并展示进度", () => {
    const onUpdate = vi.fn();
    const markup = renderDialog({ isPending: true, onUpdate, percentage: 42 });
    expect(markup).toContain('value="42"');
    expect(markup).toContain("42%");
    expect(markup.match(/disabled=""/gu)).toHaveLength(2);
    actions.update?.();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
