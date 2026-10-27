import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Questionnaire, QuestionnaireCard } from "@codexly/ui/core/questionnaire";
import { QuestionnaireChoice } from "@codexly/ui/core/questionnaire-choice";

const labels = {
  previous: "上一题",
  next: "下一题",
  progress: (current: number, total: number) => `第 ${String(current)} / ${String(total)} 题`,
};

test("只呈现当前题目并提供可访问进度与显式导航", () => {
  const markup = renderToStaticMarkup(
    <QuestionnaireCard>
      <Questionnaire
        labels={labels}
        onSubmit={() => undefined}
        items={[
          {
            id: "first",
            title: "选择范围",
            content: (
              <QuestionnaireChoice
                name="scope"
                value="all"
                checked={false}
                onChange={() => undefined}
              >
                全部文件
              </QuestionnaireChoice>
            ),
            complete: false,
          },
          { id: "second", title: "补充要求", content: <input aria-label="补充要求" /> },
        ]}
        submitLabel="提交回答"
      />
    </QuestionnaireCard>,
  );
  expect(markup).toContain('data-slot="questionnaire-card"');
  expect(markup).toContain('role="progressbar"');
  expect(markup).toContain('aria-valuenow="1"');
  expect(markup).toMatch(/hidden=""[^>]*inert=""/u);
  expect(markup).toContain("下一题");
  expect(markup).toContain('type="radio"');
});
