import type { AgentAttachment, AgentTask } from "@codexly/protocol";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import type { PromptCommandAction } from "../components/prompt-command.js";
import type { IdempotencyAttempt } from "../composer-state.js";

export function isComposerControllerScopeCurrent(
  activeScope: string,
  requestScope: string,
): boolean {
  return activeScope === requestScope;
}

export function useWorkbenchComposerController(
  routeScope: string,
  onSubmissionStateChange?: (submitting: boolean) => void,
) {
  const [isSubmitting, setIsSubmittingState] = useState(false);
  const [mutationError, setMutationErrorState] = useState<Error | null>(null);
  const [pendingTaskState, setPendingTaskState] = useState<{
    scope: string;
    task: AgentTask;
  }>();
  const [submittedTurnState, setSubmittedTurnState] = useState<{
    scope: string;
    turnId: string;
  }>();
  const routeScopeRef = useRef(routeScope);
  routeScopeRef.current = routeScope;

  const startTurnAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const steerTurnAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const interruptAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const uploadedAttachments = useRef(new Map<string, AgentAttachment>());
  const uploadAttempts = useRef(new Map<string, string>());
  const commandAttempts = useRef(new Map<PromptCommandAction, IdempotencyAttempt>());
  const actionLock = useMemo(() => {
    // 每个路由作用域使用独立锁，切换 Task 后旧请求不能阻塞新会话。
    void routeScope;
    return createAsyncActionLock();
  }, [routeScope]);

  const setIsSubmitting = useCallback(
    (submitting: boolean) => {
      // 在请求边界同步通知计时占位；React 合并 true/false 渲染时也不能漏掉结束通知。
      setIsSubmittingState(submitting);
      onSubmissionStateChange?.(submitting);
    },
    [onSubmissionStateChange],
  );

  const notifySubmissionUnmount = useEffectEvent(() => {
    onSubmissionStateChange?.(false);
  });
  useEffect(() => {
    // 回调随双引擎 Composer 重渲染而变化；仅真正卸载时清理，避免发送途中撤掉消息占位。
    // Effect Event 读取最新回调，卸载时仍通知当前任务与窗口。
    return () => {
      notifySubmissionUnmount();
    };
  }, []);

  const isCurrentScope = useCallback(
    (requestScope: string) => isComposerControllerScopeCurrent(routeScopeRef.current, requestScope),
    [],
  );

  const setMutationError = useCallback((error: Error | null) => {
    setMutationErrorState(error);
    if (error !== null) {
      notifyActionError(error);
    }
  }, []);

  const reset = useCallback(
    (clearTaskState: boolean) => {
      setIsSubmitting(false);
      setMutationError(null);
      if (clearTaskState) {
        setPendingTaskState(undefined);
        setSubmittedTurnState(undefined);
      }
      startTurnAttempt.current = undefined;
      steerTurnAttempt.current = undefined;
      interruptAttempt.current = undefined;
      uploadedAttachments.current.clear();
      uploadAttempts.current.clear();
      commandAttempts.current.clear();
    },
    [setIsSubmitting, setMutationError],
  );

  return {
    actionLock,
    commandAttempts,
    interruptAttempt,
    isCurrentScope,
    isSubmitting,
    mutationError,
    pendingTaskState,
    reset,
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setSubmittedTurnState,
    startTurnAttempt,
    steerTurnAttempt,
    submittedTurnState,
    uploadAttempts,
    uploadedAttachments,
  } as const;
}
