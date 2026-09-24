import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { useAsyncQuestions } from "./use-async-questions.js";
import { codexlyClient } from "../../projects/project-queries.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import { useActionErrorToast } from "../../notifications/use-action-error-toast.js";

const query = vi.hoisted(() => ({
  error: null as Error | null,
  options: undefined as { enabled: boolean } | undefined,
}));
const invalidateQueries = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { enabled: boolean }) => {
    query.options = options;
    return { data: undefined, error: query.error };
  },
  useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock("../../notifications/action-notifications.js", () => ({ notifyActionError: vi.fn() }));
vi.mock("../../notifications/use-action-error-toast.js", () => ({ useActionErrorToast: vi.fn() }));

function renderQuestions(taskId: string | undefined) {
  let questions: ReturnType<typeof useAsyncQuestions> | undefined;
  function Probe() {
    questions = useAsyncQuestions("project-a", taskId, () => vi.fn());
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (questions === undefined) throw new Error("Question hook was not rendered");
  return questions;
}

beforeEach(() => {
  query.error = null;
  vi.mocked(notifyActionError).mockClear();
  vi.mocked(useActionErrorToast).mockClear();
  invalidateQueries.mockClear();
});

test("question polling waits for a task ID", () => {
  renderQuestions(undefined);
  expect(query.options?.enabled).toBe(false);
  renderQuestions("task-a");
  expect(query.options?.enabled).toBe(true);
});

test("question polling errors stay silent while polling continues", () => {
  query.error = new Error("Task is not ready");
  renderQuestions("task-a");
  expect(query.options?.enabled).toBe(true);
  expect(useActionErrorToast).not.toHaveBeenCalled();
  expect(notifyActionError).not.toHaveBeenCalled();
});

test("dismiss failure uses a toast and refreshes the question cache", async () => {
  const error = new Error("Dismiss failed");
  vi.spyOn(codexlyClient, "dismissAsyncQuestions").mockRejectedValueOnce(error);
  await renderQuestions("task-a").dismiss(["question-a"]);
  expect(notifyActionError).toHaveBeenCalledWith(error);
  expect(invalidateQueries).toHaveBeenCalledOnce();
});

test("answer failure uses a toast and keeps the failure available to the form", async () => {
  const error = new Error("Answer failed");
  vi.spyOn(codexlyClient, "answerAsyncQuestion").mockRejectedValueOnce(error);
  await expect(renderQuestions("task-a").answer("question-a", ["answer"])).rejects.toBe(error);
  expect(notifyActionError).toHaveBeenCalledWith(error);
  expect(invalidateQueries).toHaveBeenCalledOnce();
});
