import type { PendingApprovalDecision, PendingRequest } from "@code-agent/protocol";
import { useEffect, useRef, useState } from "react";

import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  type ConfirmationState,
} from "../../../shared/components/agent/confirmation.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import { useTranslation } from "../../../i18n/i18n.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import {
  FileSystemPermissionDetails,
  PermissionApprovalRequestCard,
} from "./permission-approval-request.js";
import { McpElicitationRequestCard } from "./mcp-elicitation-request.js";
import {
  resolvePendingRequestAttempt,
  type PendingRequestResolutionAttempt,
  type PendingRequestResolveHandler,
} from "./pending-request-resolution.js";

export { resolvePendingRequestAttempt } from "./pending-request-resolution.js";
export type { PendingRequestResolution } from "./pending-request-resolution.js";

type PendingRequestCardProps = Readonly<{
  interactive: boolean;
  onResolve: PendingRequestResolveHandler;
  request: PendingRequest;
}>;

type ApprovalRequest = Extract<
  PendingRequest,
  { type: "command_approval" | "file_change_approval" }
>;
type CommandApprovalRequest = Extract<PendingRequest, { type: "command_approval" }>;
type UserInputRequest = Extract<PendingRequest, { type: "user_input" }>;

function approvalState(request: PendingRequest, submitting: boolean): ConfirmationState {
  if (request.status === "expired") return "approval-expired";
  if (request.status === "resolved") return "approval-resolved";
  return submitting ? "approval-submitting" : "approval-requested";
}

function formatNetworkProtocol(
  protocol: NonNullable<CommandApprovalRequest["networkAccess"]>["protocol"],
) {
  switch (protocol) {
    case "http":
      return "HTTP";
    case "https":
      return "HTTPS";
    case "socks5Tcp":
      return "SOCKS5 TCP";
    case "socks5Udp":
      return "SOCKS5 UDP";
  }
}

function ApprovalRequestCard({
  interactive,
  onResolve,
  request,
}: Omit<PendingRequestCardProps, "request"> & { request: ApprovalRequest }) {
  const { t } = useTranslation("workbench");
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState<PendingRequestResolutionAttempt>();
  const allowButtonRef = useRef<HTMLButtonElement>(null);
  const resolutionLockRef = useRef(createAsyncActionLock());
  const networkAccess = request.type === "command_approval" ? request.networkAccess : null;
  const title =
    networkAccess !== null
      ? t("pending.networkApproval")
      : request.type === "command_approval"
        ? t("pending.commandApproval")
        : t("pending.fileChangeApproval");
  const detail =
    networkAccess !== null
      ? `${formatNetworkProtocol(networkAccess.protocol)}\n${networkAccess.host}`
      : request.type === "command_approval"
        ? [request.command, request.cwd].filter(Boolean).join("\n")
        : (request.grantRoot ?? t("pending.fileChangeFallback"));
  const canSubmit = interactive && request.status === "pending" && !submitting;
  const canFocusAllow = canSubmit && request.availableDecisions.includes("allow");

  useEffect(() => {
    if (canFocusAllow) {
      // 进入待审批 Task 或当前请求变为队首时聚焦“允许”，让 Enter 可直接确认。
      allowButtonRef.current?.focus();
    }
  }, [canFocusAllow, request.requestId]);

  const resolve = (decision: PendingApprovalDecision) =>
    resolutionLockRef.current.run(async () => {
      if (!canSubmit) return;
      const resolution = { decision } as const;
      // 同一决策失败重试时保留原 Key，用户改选决策后才创建新 Key。
      const nextAttempt = resolvePendingRequestAttempt(attempt, resolution);
      setAttempt(nextAttempt);
      setSubmitting(true);
      try {
        await onResolve(request, resolution, nextAttempt.key);
        notifyActionSuccess();
      } catch (error) {
        notifyActionError(error);
        setSubmitting(false);
      }
    });

  return (
    <Confirmation approval={{ id: request.requestId }} state={approvalState(request, submitting)}>
      <ConfirmationTitle>{title}</ConfirmationTitle>
      <ConfirmationRequest>
        <pre className="whitespace-pre-wrap font-mono text-meta">{detail}</pre>
        {request.type === "command_approval" && request.additionalPermissions != null ? (
          <div className="mt-3 space-y-2 border-t border-border pt-2">
            <p className="text-label font-medium text-foreground">
              {t("pending.additionalPermissions")}
            </p>
            {request.additionalPermissions.network === null ? null : (
              <p className="text-label text-muted-foreground">{t("pending.networkPermission")}</p>
            )}
            {request.additionalPermissions.fileSystem === null ? null : (
              <div>
                <p className="text-label text-muted-foreground">
                  {t("pending.fileSystemPermission")}
                </p>
                <FileSystemPermissionDetails
                  permissions={request.additionalPermissions.fileSystem}
                />
              </div>
            )}
          </div>
        ) : null}
        {request.reason === null ? null : (
          <p className="mt-2 text-label text-muted-foreground">{request.reason}</p>
        )}
      </ConfirmationRequest>
      {request.status === "expired" ? (
        <ConfirmationRejected>{t("pending.expired")}</ConfirmationRejected>
      ) : (
        <>
          {!interactive ? (
            <p className="mt-2 text-label text-muted-foreground">{t("pending.previousPending")}</p>
          ) : null}
          <ConfirmationActions>
            {request.availableDecisions.includes("deny") ? (
              <ConfirmationAction
                disabled={!canSubmit}
                onClick={() => void resolve("deny")}
                tone="danger"
              >
                {t("pending.deny")}
              </ConfirmationAction>
            ) : null}
            {request.availableDecisions.includes("allow_for_session") ? (
              <ConfirmationAction
                disabled={!canSubmit}
                onClick={() => void resolve("allow_for_session")}
              >
                {t("pending.allowSession")}
              </ConfirmationAction>
            ) : null}
            {request.availableDecisions.includes("allow") ? (
              <ConfirmationAction
                disabled={!canSubmit}
                onClick={() => void resolve("allow")}
                ref={allowButtonRef}
                tone="primary"
              >
                {t("pending.allow")}
              </ConfirmationAction>
            ) : null}
          </ConfirmationActions>
        </>
      )}
    </Confirmation>
  );
}

type Answers = Record<string, string>;

function UserInputRequestCard({
  interactive,
  onResolve,
  request,
}: Omit<PendingRequestCardProps, "request"> & { request: UserInputRequest }) {
  const { t } = useTranslation("workbench");
  const [answers, setAnswers] = useState<Answers>({});
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState<PendingRequestResolutionAttempt>();
  const resolutionLockRef = useRef(createAsyncActionLock());
  const complete = request.questions.every(
    (question) => (answers[question.id] ?? "").trim() !== "",
  );
  const canSubmit = interactive && request.status === "pending" && complete && !submitting;
  const controlsDisabled = !interactive || submitting;

  const submit = () =>
    resolutionLockRef.current.run(async () => {
      if (!canSubmit) return;
      setSubmitting(true);
      const mappedAnswers = Object.fromEntries(
        request.questions.map((question) => [question.id, [(answers[question.id] ?? "").trim()]]),
      );
      const resolution = { answers: mappedAnswers };
      const nextAttempt = resolvePendingRequestAttempt(attempt, resolution);
      setAttempt(nextAttempt);
      try {
        await onResolve(request, resolution, nextAttempt.key);
        notifyActionSuccess();
      } catch (error) {
        notifyActionError(error);
        setSubmitting(false);
      }
    });

  if (request.status !== "pending") {
    return (
      <section className="w-full rounded-surface bg-control px-3.5 py-3 text-label text-muted-foreground">
        {request.status === "expired" ? t("pending.expired") : t("pending.processed")}
      </section>
    );
  }

  return (
    <form
      className="w-full rounded-surface bg-control px-3.5 py-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="text-label font-semibold text-foreground">{t("pending.inputRequired")}</h3>
      <div className="mt-3 space-y-4">
        {request.questions.map((question) => (
          <fieldset key={question.id}>
            <legend className="text-body-small font-medium text-foreground">
              {question.prompt}
            </legend>
            <p className="mt-0.5 text-meta text-muted-foreground">{question.header}</p>
            {question.type === "choice" ? (
              <div className="mt-2 space-y-1.5">
                {question.options.map((option, optionIndex) => (
                  <label
                    aria-label={option.label}
                    className="flex cursor-pointer items-start gap-2 rounded-control bg-raised px-2.5 py-2 text-label"
                    htmlFor={`${question.id}-option-${String(optionIndex)}`}
                    key={option.label}
                  >
                    <input
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      checked={answers[question.id] === option.label}
                      disabled={controlsDisabled}
                      id={`${question.id}-option-${String(optionIndex)}`}
                      name={question.id}
                      onChange={() => {
                        setAnswers((value) => ({ ...value, [question.id]: option.label }));
                      }}
                      type="radio"
                      value={option.label}
                    />
                    <span>
                      <span className="block font-medium text-foreground">{option.label}</span>
                      <span className="block text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
                {question.isOther ? (
                  <Input
                    aria-label={t("pending.otherAnswer", { header: question.header })}
                    disabled={controlsDisabled}
                    onChange={(event) => {
                      setAnswers((value) => ({ ...value, [question.id]: event.target.value }));
                    }}
                    placeholder={t("pending.other")}
                    type="text"
                    value={
                      question.options.some((option) => option.label === answers[question.id])
                        ? ""
                        : (answers[question.id] ?? "")
                    }
                    variant="compact"
                  />
                ) : null}
              </div>
            ) : question.type === "confirmation" ? (
              <div className="mt-2 grid grid-cols-2 rounded-control bg-raised p-0.5">
                {question.options.map((option) => (
                  <Button
                    variant="ghost"
                    aria-pressed={answers[question.id] === option.label}
                    className="h-8 rounded-control text-label font-medium text-foreground aria-pressed:bg-foreground aria-pressed:text-raised"
                    disabled={controlsDisabled}
                    key={option.label}
                    onClick={() => {
                      setAnswers((value) => ({ ...value, [question.id]: option.label }));
                    }}
                    type="button"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            ) : (
              <Input
                aria-label={question.prompt}
                className="mt-2"
                disabled={controlsDisabled}
                onChange={(event) => {
                  setAnswers((value) => ({ ...value, [question.id]: event.target.value }));
                }}
                type={question.isSecret ? "password" : "text"}
                value={answers[question.id] ?? ""}
                variant="compact"
              />
            )}
          </fieldset>
        ))}
      </div>
      {!interactive ? (
        <p className="mt-3 text-label text-muted-foreground">{t("pending.previousPending")}</p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <Button disabled={!canSubmit} size="compact" type="submit">
          {t("pending.submitAnswers")}
        </Button>
      </div>
    </form>
  );
}

export function PendingRequestCard(props: PendingRequestCardProps) {
  // 已处理请求只保留在运行时快照中用于状态对账，不继续占用会话界面。
  if (props.request.status === "resolved") {
    return null;
  }
  if (props.request.type === "user_input") {
    return (
      <UserInputRequestCard
        interactive={props.interactive}
        onResolve={props.onResolve}
        request={props.request}
      />
    );
  }
  if (props.request.type === "permissions_approval") {
    return (
      <PermissionApprovalRequestCard
        interactive={props.interactive}
        onResolve={props.onResolve}
        request={props.request}
      />
    );
  }
  if (props.request.type === "mcp_elicitation") {
    return (
      <McpElicitationRequestCard
        interactive={props.interactive}
        onResolve={props.onResolve}
        request={props.request}
      />
    );
  }
  return (
    <ApprovalRequestCard
      interactive={props.interactive}
      onResolve={props.onResolve}
      request={props.request}
    />
  );
}
