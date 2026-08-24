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
import { Input } from "../../../shared/components/core/input.js";
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

function FieldDescription({ field }: Readonly<{ field: McpElicitationField }>) {
  return field.description === null ? null : (
    <p className="mt-0.5 text-meta text-muted-foreground">{field.description}</p>
  );
}

function fieldInputType(field: Extract<McpElicitationField, { type: "string" }>) {
  if (field.format === "email") return "email";
  if (field.format === "uri") return "url";
  if (field.format === "date") return "date";
  return "text";
}

function McpFormField({
  content,
  controlPrefix,
  disabled,
  field,
  setContent,
}: Readonly<{
  content: FormContent;
  controlPrefix: string;
  disabled: boolean;
  field: McpElicitationField;
  setContent: (update: (current: FormContent) => FormContent) => void;
}>) {
  const controlId = `mcp-field-${controlPrefix}-${field.id}`;
  const update = (value: FormContent[string] | undefined) => {
    setContent((current) => {
      if (value === undefined) {
        return Object.fromEntries(Object.entries(current).filter(([id]) => id !== field.id));
      }
      return { ...current, [field.id]: value };
    });
  };

  if (field.type === "boolean") {
    return (
      <label
        className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control bg-raised px-3 py-2 text-label text-foreground"
        htmlFor={controlId}
      >
        <input
          checked={content[field.id] === true}
          disabled={disabled}
          id={controlId}
          onChange={(event) => {
            update(event.target.checked);
          }}
          type="checkbox"
        />
        <span>
          <span className="block font-medium">{field.title}</span>
          <FieldDescription field={field} />
        </span>
      </label>
    );
  }

  if (field.type === "select") {
    const selectedIndex = field.options.findIndex((option) => option.value === content[field.id]);
    return (
      <div>
        <label className="text-label font-medium text-foreground" htmlFor={controlId}>
          {field.title}
        </label>
        <FieldDescription field={field} />
        <select
          className="mt-2 h-11 w-full rounded-control border border-separator-strong bg-raised px-2.5 text-label text-foreground outline-none focus-visible:border-brand focus-visible:shadow-focus workbench:h-8"
          disabled={disabled}
          id={controlId}
          onChange={(event) => {
            const option = field.options[Number(event.target.value)];
            update(option?.value);
          }}
          required={field.required}
          value={selectedIndex < 0 ? "" : String(selectedIndex)}
        >
          <option disabled={field.required} value="">
            --
          </option>
          {field.options.map((option, index) => (
            <option key={option.value} value={index}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "multi_select") {
    const currentValue = content[field.id];
    const selected: readonly string[] = Array.isArray(currentValue) ? currentValue : [];
    return (
      <fieldset>
        <legend className="text-label font-medium text-foreground">{field.title}</legend>
        <FieldDescription field={field} />
        <div className="mt-2 grid grid-cols-1 gap-2 @sm:grid-cols-2">
          {field.options.map((option) => (
            <label
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control bg-raised px-3 py-2 text-label text-foreground"
              key={option.value}
            >
              <input
                checked={selected.includes(option.value)}
                disabled={disabled}
                onChange={(event) => {
                  update(
                    event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value),
                  );
                }}
                type="checkbox"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  const value = content[field.id];
  return (
    <div>
      <label className="text-label font-medium text-foreground" htmlFor={controlId}>
        {field.title}
      </label>
      <FieldDescription field={field} />
      <Input
        className="mt-2 max-workbench:h-11"
        disabled={disabled}
        id={controlId}
        max={field.type === "string" ? undefined : (field.maximum ?? undefined)}
        maxLength={field.type === "string" ? (field.maxLength ?? undefined) : undefined}
        min={field.type === "string" ? undefined : (field.minimum ?? undefined)}
        minLength={field.type === "string" ? (field.minLength ?? undefined) : undefined}
        onChange={(event) => {
          if (field.type === "string") {
            update(event.target.value);
            return;
          }
          update(event.target.value === "" ? undefined : event.target.valueAsNumber);
        }}
        required={field.required}
        step={field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined}
        type={field.type === "string" ? fieldInputType(field) : "number"}
        value={typeof value === "number" || typeof value === "string" ? value : ""}
        variant="compact"
      />
    </div>
  );
}

function McpFormRequestCard({
  interactive,
  onResolve,
  request,
}: Omit<McpElicitationRequestCardProps, "request"> & { request: FormRequest }) {
  const { t } = useTranslation("workbench");
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
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void resolve({ action: "accept", content });
          }}
        >
          {request.fields.map((field) => (
            <McpFormField
              content={content}
              controlPrefix={request.requestId}
              disabled={!interactive || submitting}
              field={field}
              key={field.id}
              setContent={setContent}
            />
          ))}
          {!interactive ? (
            <p className="text-label text-muted-foreground">{t("pending.previousPending")}</p>
          ) : null}
          <ConfirmationActions>
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
            <ConfirmationAction disabled={!canSubmit} tone="primary" type="submit">
              {t("pending.submitAnswers")}
            </ConfirmationAction>
          </ConfirmationActions>
        </form>
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
