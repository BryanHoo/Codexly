import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreateBranchDialog } from "./create-branch-dialog.js";

describe("CreateBranchDialog", () => {
  it("渲染可访问的分支名称表单", () => {
    const markup = renderToStaticMarkup(
      <CreateBranchDialog
        isPending={false}
        onClose={() => undefined}
        onCreate={() => Promise.resolve(true)}
      />,
    );

    expect(markup).toContain('aria-labelledby="create-branch-title"');
    expect(markup).toContain("基于当前分支创建并立即切换");
    expect(markup).toContain('for="create-branch-name"');
    expect(markup).toContain('name="branch"');
    expect(markup).toContain('placeholder="feat/my-feature"');
    expect(markup).toContain("创建并切换");
  });

  it("提交期间禁用输入与操作且不在弹窗内展示动作错误", () => {
    const markup = renderToStaticMarkup(
      <CreateBranchDialog
        isPending
        onClose={() => undefined}
        onCreate={() => Promise.resolve(false)}
      />,
    );

    expect(markup).not.toContain('role="alert"');
    expect(markup.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(3);
  });
});
