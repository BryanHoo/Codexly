import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AsyncQuestionComposer } from "./async-question-composer.js";

vi.mock("../hooks/use-async-questions.js", () => ({
  useAsyncQuestions: () => ({
    groups: [],
    answer: vi.fn(),
    dismiss: vi.fn(),
    dismissing: false,
    error: true,
  }),
}));

test("question sync failures do not remain above the composer", () => {
  const markup = renderToStaticMarkup(
    <AsyncQuestionComposer
      enabled
      projectId="project-a"
      taskId="task-a"
      onAnswered={() => vi.fn()}
    />,
  );
  expect(markup).not.toContain("问题状态同步失败");
  expect(markup).not.toContain('role="alert"');
});
