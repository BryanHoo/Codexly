import type {
  McpElicitationField,
  McpFormElicitationResolution,
  McpElicitationResolution,
  PendingRequest,
} from "@/protocol/index.js";
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
import { Questionnaire } from "@codexly/ui/core/questionnaire";
import { McpQuestionnaireField } from "@codexly/ui/core/mcp-questionnaire-field";
import { useTranslation } from "../../../i18n/i18n.js";
import { openExternalUrl } from "../../../platform/tauri/external-url.js";
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
type FormContent = Extract<McpFormElicitationResolution, { action: "accept" }>["content"];

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
  const resolveAfter = (
    beforeResolve: (() => Promise<void>) | undefined,
    resolution: McpElicitationResolution,
  ) =>
    lockRef.current.run(async () => {
      if (!canSubmit) return;
      const nextAttempt = resolvePendingRequestAttempt(attempt, resolution);
      setAttempt(nextAttempt);
      setSubmitting(true);
      try {
        await beforeResolve?.();
        await onResolve(request, resolution, nextAttempt.key);
        notifyActionSuccess();
      } catch (error) {
        notifyActionError(error);
        setSubmitting(false);
      }
    });
  const resolve = (resolution: McpElicitationResolution) => resolveAfter(undefined, resolution);
  return { canSubmit, resolve, resolveAfter, submitting };
}

function parseExternalElicitationUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    // 系统浏览器入口仅接收 Web URL，阻止自定义协议触发本地应用或特权处理器。
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
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
        <Questionnaire className="mt-3" disabled={!interactive} submitting={submitting}
          labels={{ previous: qt("questionnaire.previous"), next: qt("questionnaire.next"),
            progress: (current, total) => qt("questionnaire.progress", { current, total }) }}
          submitLabel={t("pending.submitAnswers")} submitDisabled={!canSubmit}
          onSubmit={() => { void resolve({ action: "accept", content }); }}
          feedback={!interactive ? t("pending.previousPending") : undefined}
          items={request.fields.map(field => ({ id: field.id, title: field.title,
            description: field.description,
            complete: field.type === "multi_select" ? (() => {
              const value = content[field.id];
              const count = Array.isArray(value) ? value.length : 0;
              return count >= (field.minimum ?? (field.required ? 1 : 0)) && (field.maximum === null || count <= field.maximum);
            })() : undefined,
            content: <McpQuestionnaireField field={field} controlPrefix={request.requestId} value={content[field.id]}
              onChange={value => setContent(current => {
                if (value === undefined) return Object.fromEntries(Object.entries(current).filter(([id]) => id !== field.id));
                return { ...current, [field.id]: value };
              })} />,
          }))}
          actions={<>
            <ConfirmationAction disabled={!canSubmit} onClick={() => void resolve({ action: "cancel" })} type="button">{t("pending.cancel")}</ConfirmationAction>
            <ConfirmationAction disabled={!canSubmit} onClick={() => void resolve({ action: "decline" })} tone="danger" type="button">{t("pending.deny")}</ConfirmationAction>
          </>}
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
  const { canSubmit, resolve, resolveAfter, submitting } = useMcpResolution({
    interactive,
    onResolve,
    request,
  });
  const externalUrl = request.mode === "url" ? parseExternalElicitationUrl(request.url) : null;

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
        {request.mode === "url" ? (
          <dl className="mt-3 space-y-2 border-t border-separator pt-2.5">
            <div>
              <dt className="text-meta text-muted-foreground">{t("pending.targetDomain")}</dt>
              <dd className="mt-0.5 font-semibold text-foreground">
                {externalUrl?.hostname ?? t("pending.invalidUrl")}
              </dd>
            </div>
            <div>
              <dt className="text-meta text-muted-foreground">{t("pending.targetUrl")}</dt>
              <dd className="mt-0.5 select-text break-all font-mono text-label text-foreground">
                {request.url}
              </dd>
            </div>
          </dl>
        ) : null}
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
              onClick={() => void resolve({ action: "cancel" })}
            >
              {t("pending.cancel")}
            </ConfirmationAction>
            <ConfirmationAction
              disabled={!canSubmit}
              onClick={() => void resolve({ action: "decline" })}
              tone="danger"
            >
              {t("pending.deny")}
            </ConfirmationAction>
            {request.mode === "url" ? (
              <ConfirmationAction
                disabled={!canSubmit || externalUrl === null}
                onClick={() => {
                  if (externalUrl === null) return;
                  // 只有系统浏览器确认接管 URL 后，才向 MCP server 回传用户同意。
                  void resolveAfter(() => openExternalUrl(externalUrl.href), { action: "accept" });
                }}
                tone="primary"
              >
                <ExternalLink aria-hidden="true" />
                {t("pending.openUrl")}
              </ConfirmationAction>
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
