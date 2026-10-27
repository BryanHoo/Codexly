import type {
  McpElicitationField,
  McpElicitationResolution,
  PendingRequest,
} from "@codexly/protocol";
import { ExternalLink } from "lucide-react";
import { useRef, useState } from "react";

import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  type ConfirmationState,
} from "../../../shared/components/agent/confirmation.js";
import { Button } from "../../../shared/components/core/button.js";
import { Questionnaire } from "@codexly/ui/core/questionnaire";
import { McpQuestionnaireField } from "@codexly/ui/core/mcp-questionnaire-field";
import { useTranslation } from "../../../i18n/i18n.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import {
  resolvePendingRequestAttempt,
  type PendingRequestResolutionAttempt,
  type PendingRequestResolveHandler,
} from "./pending-request-resolution.js";

type McpElicitationRequest = Extract<PendingRequest, { type: "mcp_elicitation" }>;
type FormRequest = Extract<McpElicitationRequest, { mode: "form" }>;
type FormContent = Extract<McpElicitationResolution, { action: "accept" }>["content"];

type McpElicitationRequestCardProps = Readonly<{
  interactive: boolean;
  onResolve: PendingRequestResolveHandler;
  request: McpElicitationRequest;
}>;

function confirmationState(request: McpElicitationRequest, submitting: boolean): ConfirmationState {
  if (request.status === "expired") return "approval-expired";
  if (request.status === "resolved") return "approval-resolved";
  return submitting ? "approval-submitting" : "approval-requested";
}

function useMcpResolution({ interactive, onResolve, request }: McpElicitationRequestCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState<PendingRequestResolutionAttempt>();
  const lockRef = useRef(createAsyncActionLock());
  const canSubmit = interactive && request.status === "pending" && !submitting;
  const resolve = (resolution: McpElicitationResolution) =>
    lockRef.current.run(async () => {
      if (!canSubmit) return;
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
  return { canSubmit, resolve, submitting };
}

function initialFormContent(fields: readonly McpElicitationField[]): FormContent {
  const content: Record<string, boolean | number | string | string[]> = {};
  for (const field of fields) {
    if (field.type === "boolean") content[field.id] = field.defaultValue ?? false;
    else if (field.type === "multi_select") content[field.id] = field.defaultValue;
    else if (field.defaultValue !== null) content[field.id] = field.defaultValue;
    else if (field.required && field.type === "string") content[field.id] = "";
  }
  return content;
}

function McpFormRequestCard({
  interactive,
  onResolve,
  request,
}: Omit<McpElicitationRequestCardProps, "request"> & { request: FormRequest }) {
  const { t } = useTranslation("workbench");
  const { t: qt } = useTranslation("conversation");
  const [content, setContent] = useState<FormContent>(() => initialFormContent(request.fields));
  const { canSubmit, resolve, submitting } = useMcpResolution({
    interactive,
    onResolve,
    request,
  });

  return (
    <Confirmation
      approval={{ id: request.requestId }}
      className="@container"
      state={confirmationState(request, submitting)}
    >
      <ConfirmationTitle>{t("pending.mcpForm", { server: request.serverName })}</ConfirmationTitle>
      <ConfirmationRequest>{request.message}</ConfirmationRequest>
      {request.status === "expired" ? (
        <ConfirmationRejected>{t("pending.expired")}</ConfirmationRejected>
      ) : (
        <Questionnaire
          className="mt-3"
          disabled={!interactive}
          submitting={submitting}
          labels={{
            previous: qt("questionnaire.previous"),
            next: qt("questionnaire.next"),
            progress: (current, total) => qt("questionnaire.progress", { current, total }),
          }}
          submitLabel={t("pending.submitAnswers")}
          submitDisabled={!canSubmit}
          onSubmit={() => {
            void resolve({ action: "accept", content });
          }}
          feedback={!interactive ? t("pending.previousPending") : undefined}
          items={request.fields.map((field) => ({
            id: field.id,
            title: field.title,
            description: field.description,
            complete:
              field.type === "multi_select"
                ? (() => {
                    const value = content[field.id];
                    const count = Array.isArray(value) ? value.length : 0;
                    return (
                      count >= (field.minimum ?? (field.required ? 1 : 0)) &&
                      (field.maximum === null || count <= field.maximum)
                    );
                  })()
                : undefined,
            content: (
              <McpQuestionnaireField
                field={field}
                controlPrefix={request.requestId}
                value={content[field.id]}
                onChange={(value) => {
                  setContent((current) => {
                    if (value === undefined)
                      return Object.fromEntries(
                        Object.entries(current).filter(([id]) => id !== field.id),
                      );
                    return { ...current, [field.id]: value };
                  });
                }}
              />
            ),
          }))}
          actions={
            <>
              <ConfirmationAction
                disabled={!canSubmit}
                onClick={() => void resolve({ action: "cancel", content: null })}
                type="button"
              >
                {t("pending.cancel")}
              </ConfirmationAction>
              <ConfirmationAction
                disabled={!canSubmit}
                onClick={() => void resolve({ action: "decline", content: null })}
                tone="danger"
                type="button"
              >
                {t("pending.deny")}
              </ConfirmationAction>
            </>
          }
        />
      )}
    </Confirmation>
  );
}

function McpConfirmationRequestCard({
  interactive,
  onResolve,
  request,
}: McpElicitationRequestCardProps) {
  const { t } = useTranslation("workbench");
  const { canSubmit, resolve, submitting } = useMcpResolution({
    interactive,
    onResolve,
    request,
  });

  return (
    <Confirmation
      approval={{ id: request.requestId }}
      state={confirmationState(request, submitting)}
    >
      <ConfirmationTitle>
        {t("pending.mcpRequest", { server: request.serverName })}
      </ConfirmationTitle>
      <ConfirmationRequest>
        <p>{request.message}</p>
        {request.mode === "unsupported" ? (
          <p className="mt-2 text-label text-muted-foreground">{t("pending.unsupportedForm")}</p>
        ) : null}
      </ConfirmationRequest>
      {request.status === "expired" ? (
        <ConfirmationRejected>{t("pending.expired")}</ConfirmationRejected>
      ) : (
        <>
          {!interactive ? (
            <p className="mt-2 text-label text-muted-foreground">{t("pending.previousPending")}</p>
          ) : null}
          <ConfirmationActions>
            <ConfirmationAction
              disabled={!canSubmit}
              onClick={() => void resolve({ action: "cancel", content: null })}
            >
              {t("pending.cancel")}
            </ConfirmationAction>
            <ConfirmationAction
              disabled={!canSubmit}
              onClick={() => void resolve({ action: "decline", content: null })}
              tone="danger"
            >
              {t("pending.deny")}
            </ConfirmationAction>
            {request.mode === "url" ? (
              <Button asChild size="compact">
                <a
                  aria-disabled={!canSubmit}
                  href={request.url}
                  onClick={(event) => {
                    if (!canSubmit) {
                      event.preventDefault();
                      return;
                    }
                    void resolve({ action: "accept", content: {} });
                  }}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  <ExternalLink aria-hidden="true" />
                  {t("pending.openUrl")}
                </a>
              </Button>
            ) : null}
          </ConfirmationActions>
        </>
      )}
    </Confirmation>
  );
}

export function McpElicitationRequestCard(props: McpElicitationRequestCardProps) {
  return props.request.mode === "form" ? (
    <McpFormRequestCard {...props} request={props.request} />
  ) : (
    <McpConfirmationRequestCard {...props} />
  );
}
