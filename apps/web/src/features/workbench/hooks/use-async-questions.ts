import type { AnswerAsyncQuestionResponse } from "@codexly/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import { useActionErrorToast } from "../../notifications/use-action-error-toast.js";
import { codexlyClient } from "../../projects/project-queries.js";

export function useAsyncQuestions(
  projectId: string,
  taskId: string | undefined,
  onAnswered: () => (result: AnswerAsyncQuestionResponse) => void,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation("conversation");
  const queryKey = ["async-questions", projectId, taskId];
  const [dismissing, setDismissing] = useState(false);
  const query = useQuery({
    queryKey,
    // 仅进入已创建的 Task 后轮询，避免新建期间的临时 ID 触发错误提示。
    enabled: taskId !== undefined,
    queryFn: ({ signal }) => codexlyClient.listAsyncQuestions(projectId, taskId ?? "", { signal }),
    // 后端提供完整待处理集合；轮询不依赖虚拟列表已加载的历史或消息文本。
    refetchInterval: 2000,
    retry: false,
  });
  useActionErrorToast(query.error, t("asyncQuestions.syncFailed"));
  const answer = async (id: string, answers: readonly string[]) => {
    if (taskId === undefined) return false;
    const accept = onAnswered();
    try {
      const result = await codexlyClient.answerAsyncQuestion(projectId, taskId, id, answers);
      await queryClient.cancelQueries({ queryKey });
      // Node 返回投递完成后的权威集合，浏览器只更新渲染缓存。
      queryClient.setQueryData(queryKey, result.questions);
      accept(result);
      return true;
    } catch (error) {
      // 失败也刷新：其他页面可能已经处理，或后端正在保留未知投递结果。
      notifyActionError(error);
      await queryClient.invalidateQueries({ queryKey });
      throw error;
    }
  };
  const dismiss = async (ids: readonly string[]) => {
    if (taskId === undefined || dismissing || ids.length === 0) return;
    setDismissing(true);
    try {
      // Node 在单次事务中批量关闭当前展示的 ID，不影响同时出现的新问题。
      const questions = await codexlyClient.dismissAsyncQuestions(projectId, taskId, ids);
      queryClient.setQueryData(queryKey, questions);
    } catch (error) {
      notifyActionError(error);
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setDismissing(false);
    }
  };
  return {
    groups: query.data?.data ?? [],
    answer,
    dismiss,
    dismissing,
  };
}
