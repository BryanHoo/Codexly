import type { AnswerAsyncQuestionResponse } from "@codexly/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { codexlyClient } from "../../projects/project-queries.js";

export function useAsyncQuestions(
  projectId: string,
  taskId: string | undefined,
  onAnswered: () => (result: AnswerAsyncQuestionResponse) => void,
) {
  const queryClient = useQueryClient();
  const queryKey = ["async-questions", projectId, taskId];
  const [dismissing, setDismissing] = useState(false);
  const [dismissError, setDismissError] = useState(false);
  const query = useQuery({
    queryKey,
    enabled: taskId !== undefined,
    queryFn: ({ signal }) => codexlyClient.listAsyncQuestions(projectId, taskId ?? "", { signal }),
    // 后端提供完整待处理集合；轮询不依赖虚拟列表已加载的历史或消息文本。
    refetchInterval: 2000,
    retry: false,
  });
  const answer = async (id: string, answers: readonly string[]) => {
    if (taskId === undefined) return false;
    const accept = onAnswered();
    try {
      const result = await codexlyClient.answerAsyncQuestion(projectId, taskId, id, answers);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<Awaited<ReturnType<typeof codexlyClient.listAsyncQuestions>>>(
        queryKey,
        (page) =>
          page === undefined
            ? page
            : { data: page.data.filter((group) => group.id !== result.question.id) },
      );
      accept(result);
      return true;
    } finally {
      // 失败也刷新：其他页面可能已经处理，或后端正在保留未知投递结果。
      await queryClient.invalidateQueries({ queryKey });
    }
  };
  const dismiss = async (ids: readonly string[]) => {
    if (taskId === undefined || dismissing || ids.length === 0) return;
    setDismissing(true);
    setDismissError(false);
    try {
      // 关闭只针对当前展示的 ID，不能影响同时出现的新问题。
      for (let index = 0; index < ids.length; index += 128) {
        await codexlyClient.dismissAsyncQuestions(projectId, taskId, ids.slice(index, index + 128));
      }
    } catch {
      setDismissError(true);
    } finally {
      await queryClient.invalidateQueries({ queryKey });
      setDismissing(false);
    }
  };
  return {
    groups: query.data?.data ?? [],
    answer,
    dismiss,
    dismissing,
    error: dismissError || query.isError,
  };
}
