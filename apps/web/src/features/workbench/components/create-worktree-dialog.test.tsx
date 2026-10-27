import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreateWorktreeDialog } from "./create-worktree-dialog.js";

describe("CreateWorktreeDialog", () => {
  it("渲染可访问的 worktree 分支表单", () => {
    const markup = renderToStaticMarkup(
      <CreateWorktreeDialog
        isPending={false}
        onClose={() => undefined}
        onCreate={() => Promise.resolve(true)}
      />,
    );

    expect(markup).toContain('aria-labelledby="create-worktree-title"');
    expect(markup).toContain('data-slot="dialog-close"');
    expect(markup).toContain('aria-label="关闭"');
    expect(markup).toContain("创建 worktree");
    expect(markup).toContain('for="create-worktree-branch"');
    expect(markup).toContain('name="branch"');
    expect(markup).toContain("创建并选择 worktree");
    expect(markup).not.toContain("执行引擎");
  });

  it("提交期间禁用输入与操作", () => {
    const markup = renderToStaticMarkup(
      <CreateWorktreeDialog
        isPending
        onClose={() => undefined}
        onCreate={() => Promise.resolve(false)}
      />,
    );

    expect(markup.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(3);
  });
});
