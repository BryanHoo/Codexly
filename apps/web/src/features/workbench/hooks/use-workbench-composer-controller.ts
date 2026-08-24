import type { AgentAttachment, AgentTask } from "@code-agent/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  const startTaskAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
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

  useEffect(() => {
    onSubmissionStateChange?.(isSubmitting);
  }, [isSubmitting, onSubmissionStateChange]);

  useEffect(
    () => () => {
      onSubmissionStateChange?.(false);
    },
    [onSubmissionStateChange],
  );

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
      startTaskAttempt.current = undefined;
      startTurnAttempt.current = undefined;
      steerTurnAttempt.current = undefined;
      interruptAttempt.current = undefined;
      uploadedAttachments.current.clear();
      uploadAttempts.current.clear();
      commandAttempts.current.clear();
    },
    [setMutationError],
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
    startTaskAttempt,
    startTurnAttempt,
    steerTurnAttempt,
    submittedTurnState,
    uploadAttempts,
    uploadedAttachments,
  } as const;
}
