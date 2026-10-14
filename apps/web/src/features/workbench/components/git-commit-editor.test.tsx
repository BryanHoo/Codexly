import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  createCommitDraft,
  parseCommitDraft,
  serializeCommitDraft,
} from "@codexly/frontend-core/git-commit-draft";
import { GitCommitEditor } from "@codexly/ui/core/git-commit-editor";

it("在单一提交信息输入框中保留完整的多行草稿与 AI 结果", () => {
  const message = "feat(git): 优化提交体验\n\n保留完整的多行提交信息";
  const markup = renderToStaticMarkup(
    <GitCommitEditor
      draft={{ ...createCommitDraft("snapshot", []), message }}
      generating={false}
      disabled={false}
      canGenerate={false}
      onGenerate={() => undefined}
      update={() => undefined}
      t={(key) => key}
    />,
  );
  expect(markup.match(/<textarea\b/gu)).toHaveLength(1);
  expect(markup).toContain(`${message}</textarea>`);
});

it("不再显示已存旧草稿的覆盖确认，保留撤销生成入口", () => {
  const draft = {
    ...createCommitDraft("snapshot", []),
    message: "新提交信息",
    previousMessage: "原提交信息",
  };
  const stored = JSON.stringify({
    ...(JSON.parse(serializeCommitDraft(draft)) as Record<string, unknown>),
    suggestion: "旧建议",
  });
  const markup = renderToStaticMarkup(
    <GitCommitEditor
      draft={parseCommitDraft(stored) ?? draft}
      generating={false}
      disabled={false}
      canGenerate
      onGenerate={() => undefined}
      update={() => undefined}
      t={(key) => key}
    />,
  );
  expect(markup).not.toContain("commit.useSuggestion");
  expect(markup).not.toContain("commit.keepDraft");
  expect(markup).toContain("commit.undoGeneration");
});
