import type { PendingRequest } from "@codexly/protocol";
import { useEffect, useMemo, useState } from "react";
import { v4 as createUuid } from "uuid";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "../agent/confirmation.js";

type Request = Extract<PendingRequest, { type: "tool_approval" }>;
interface Resolution {
  decision: "allow" | "deny";
  optionId: string;
}
interface Attempt {
  fingerprint: string;
  key: string;
}

/** ACP 选项始终逐项呈现；kind 仅决定按钮语气，授权范围以原始 optionId 为准。 */
export function AcpPermissionRequest({
  request,
  interactive,
  onResolve,
  onError,
  onSuccess,
  labels,
}: Readonly<{
  request: Request;
  interactive: boolean;
  onResolve: (request: Request, resolution: Resolution, idempotencyKey: string) => Promise<unknown>;
  onError: (error: unknown) => void;
  onSuccess: () => void;
  labels: { title: string; expired: string; waiting: string };
}>) {
  const scope = useMemo(
    () => ({
      active: true,
      busy: false,
      attempt: undefined as Attempt | undefined,
    }),
    [
      request.projectId,
      request.taskId,
      request.turnId,
      request.itemId,
      request.requestId,
      request.createdAt,
    ],
  );
  const [submission, setSubmission] = useState<{ scope: object; pending: boolean }>();
  const submitting = submission?.scope === scope && submission.pending;
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
    };
  }, [scope]);
  const disabled = !interactive || request.status !== "pending" || submitting;
  const isActive = () => scope.active;
  const resolve = async (option: NonNullable<Request["acpOptions"]>[number]) => {
    if (disabled || scope.busy || !scope.active) return;
    // 同步占用先于 React 更新，双击、Enter 和触控不会并发提交两个授权。
    scope.busy = true;
    const resolution: Resolution = {
      decision: option.kind === "allow_once" || option.kind === "allow_always" ? "allow" : "deny",
      optionId: option.optionId,
    };
    const fingerprint = JSON.stringify(resolution);
    const attempt =
      scope.attempt?.fingerprint === fingerprint
        ? scope.attempt
        : { fingerprint, key: createUuid() };
    scope.attempt = attempt;
    setSubmission({ scope, pending: true });
    try {
      await onResolve(request, resolution, attempt.key);
      // 成功后由权威事件撤下卡片；响应与事件间隙继续锁住，禁止重复选择。
      if (isActive()) onSuccess();
    } catch (error) {
      scope.busy = false;
      if (isActive()) {
        setSubmission({ scope, pending: false });
        onError(error);
      }
    }
  };
  if (request.status === "resolved") return null;
  return (
    <Confirmation
      approval={{ id: request.requestId }}
      state={
        request.status === "expired"
          ? "approval-expired"
          : submitting
            ? "approval-submitting"
            : "approval-requested"
      }
    >
      <ConfirmationTitle>{labels.title}</ConfirmationTitle>
      <ConfirmationRequest>
        <pre className="whitespace-pre-wrap font-mono text-meta">
          {JSON.stringify(request.input, null, 2)}
        </pre>
        {request.reason ? (
          <p className="mt-2 text-label text-muted-foreground">{request.reason}</p>
        ) : null}
      </ConfirmationRequest>
      {request.status === "expired" ? (
        <ConfirmationRejected>{labels.expired}</ConfirmationRejected>
      ) : (
        <>
          {!interactive ? (
            <p className="mt-2 text-label text-muted-foreground">{labels.waiting}</p>
          ) : null}
          <ConfirmationActions>
            {(request.acpOptions ?? []).map((option) => (
              <ConfirmationAction
                key={option.optionId}
                disabled={disabled}
                tone={
                  option.kind === "reject_once" || option.kind === "reject_always"
                    ? "danger"
                    : option.kind === "allow_once"
                      ? "primary"
                      : "neutral"
                }
                className="h-auto min-h-6 whitespace-normal text-left"
                onClick={() => {
                  void resolve(option);
                }}
              >
                {option.name}
              </ConfirmationAction>
            ))}
          </ConfirmationActions>
        </>
      )}
    </Confirmation>
  );
}
