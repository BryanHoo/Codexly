import {
  parseElicitationUrl,
  type McpElicitationField,
  type PendingRequest,
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
} from "../agent/confirmation.js";
import { Questionnaire, type QuestionnaireLabels } from "./questionnaire.js";
import { McpQuestionnaireField, type McpQuestionnaireContent } from "./mcp-questionnaire-field.js";
import {
  CodexAsyncQuestionnaire,
  readCodexAsyncQuestions,
  type CodexAsyncQuestionLabels,
} from "./codex-async-questionnaire.js";

type Request = Extract<PendingRequest, { type: "mcp_elicitation" }>;
type FormRequest = Extract<Request, { mode: "form" }>;
type FormContent = McpQuestionnaireContent;
export type ElicitationAnswer =
  { action: "accept"; content?: FormContent } | { action: "cancel" | "decline" };

type Props = Readonly<{
  interactive: boolean;
  onResolve: (answer: ElicitationAnswer) => Promise<void>;
  onError: (error: unknown) => void;
  openUrl: (url: string) => void | Promise<void>;
  request: Request;
  questionnaireLabels: QuestionnaireLabels;
  asyncQuestionLabels?: CodexAsyncQuestionLabels;
  labels: Readonly<{
    title: string;
    submit: string;
    cancel: string;
    decline: string;
    expired: string;
    inactive: string;
    unsupported: string;
    open: string;
    domain: string;
    url: string;
    suspicious: string;
    invalidUrl: string;
    opened: string;
    completed: string;
  }>;
}>;

function useResolution({ interactive, onResolve, onError, request }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const locked = useRef(false);
  const opened = useRef(false);
  const canSubmit = interactive && request.status === "pending" && !submitting;
  const resolve = async (answer: ElicitationAnswer, open?: () => void | Promise<void>) => {
    if (!canSubmit || locked.current) return;
    locked.current = true;
    setSubmitting(true);
    try {
      // 打开动作始终由用户点击触发。回传失败后重试沿用原有同意，避免再次打开浏览器。
      if (open && !opened.current) {
        await open();
        opened.current = true;
      }
      await onResolve(answer);
    } catch (error) {
      locked.current = false;
      setSubmitting(false);
      onError(error);
    }
  };
  return { canSubmit, resolve, submitting };
}

function confirmationState(request: Request, submitting: boolean): ConfirmationState {
  if (request.status === "expired") return "approval-expired";
  if (request.status === "resolved") return "approval-resolved";
  return submitting ? "approval-submitting" : "approval-requested";
}

function initialFormContent(fields: readonly McpElicitationField[], acp: boolean): FormContent {
  const content: FormContent = {};
  for (const field of fields) {
    if (field.type === "boolean") {
      if (!acp || field.required || field.defaultValue !== null)
        content[field.id] = field.defaultValue ?? false;
    } else if (field.type === "multi_select") {
      if (!acp || field.required || field.defaultValue.length)
        content[field.id] = field.defaultValue;
    } else if (field.defaultValue !== null) content[field.id] = field.defaultValue;
  }
  return content;
}

function FormCard(props: Props & { request: FormRequest }) {
  const { request, interactive, labels, questionnaireLabels } = props;
  const { canSubmit, resolve, submitting } = useResolution(props);
  const [content, setContent] = useState(() =>
    initialFormContent(request.fields, request.acp === true),
  );
  return (
    <Confirmation
      approval={{ id: request.requestId }}
      className="@container"
      state={confirmationState(request, submitting)}
    >
      <ConfirmationTitle>{labels.title}</ConfirmationTitle>
      <ConfirmationRequest>{request.message}</ConfirmationRequest>
      {request.status === "expired" ? (
        <ConfirmationRejected>{labels.expired}</ConfirmationRejected>
      ) : (
        <Questionnaire
          className="mt-3"
          disabled={!interactive}
          submitting={submitting}
          labels={questionnaireLabels}
          title={request.formTitle}
          description={request.formDescription}
          submitLabel={labels.submit}
          submitDisabled={!canSubmit}
          onSubmit={() => void resolve({ action: "accept", content })}
          feedback={!interactive ? labels.inactive : undefined}
          items={request.fields.map((field) => {
            const value = Object.hasOwn(content, field.id) ? content[field.id] : undefined;
            const count = Array.isArray(value) ? value.length : 0;
            const minimum =
              field.type === "multi_select"
                ? (field.minimum ?? (field.required && !request.acp ? 1 : 0))
                : 0;
            return {
              id: field.id,
              title: field.title,
              description: field.description,
              complete:
                field.type === "multi_select" && (value !== undefined || field.required)
                  ? count >= minimum && (field.maximum === null || count <= field.maximum)
                  : undefined,
              content: (
                <McpQuestionnaireField
                  field={field}
                  controlPrefix={request.requestId}
                  value={value}
                  onChange={(next) => {
                    setContent((current) => {
                      if (next !== undefined) return { ...current, [field.id]: next };
                      const { [field.id]: _removed, ...rest } = current;
                      return rest;
                    });
                  }}
                />
              ),
            };
          })}
          actions={<DismissActions canSubmit={canSubmit} labels={labels} resolve={resolve} />}
        />
      )}
    </Confirmation>
  );
}

function DismissActions({
  canSubmit,
  labels,
  resolve,
}: {
  canSubmit: boolean;
  labels: Props["labels"];
  resolve: (answer: ElicitationAnswer) => Promise<void>;
}) {
  return (
    <>
      <ConfirmationAction
        disabled={!canSubmit}
        onClick={() => void resolve({ action: "cancel" })}
        type="button"
      >
        {labels.cancel}
      </ConfirmationAction>
      <ConfirmationAction
        disabled={!canSubmit}
        onClick={() => void resolve({ action: "decline" })}
        tone="danger"
        type="button"
      >
        {labels.decline}
      </ConfirmationAction>
    </>
  );
}

function ConfirmationCard(props: Props) {
  const { request, labels, interactive, openUrl } = props;
  const { canSubmit, resolve, submitting } = useResolution(props);
  const externalUrl = request.mode === "url" ? parseElicitationUrl(request.url) : null;
  const suspicious =
    externalUrl &&
    (externalUrl.protocol !== "https:" ||
      externalUrl.hostname.split(".").some((label) => label.startsWith("xn--")));
  return (
    <Confirmation
      approval={{ id: request.requestId }}
      state={confirmationState(request, submitting)}
    >
      <ConfirmationTitle>{labels.title}</ConfirmationTitle>
      {request.mode === "url" && request.externalStatus ? (
        <ConfirmationRequest>
          <p role="status">
            {request.externalStatus === "opened" ? labels.opened : labels.completed}
          </p>
        </ConfirmationRequest>
      ) : (
        <>
          <ConfirmationRequest>
            <p>{request.message}</p>
            {request.mode === "url" ? (
              <dl className="mt-3 space-y-2 border-t border-separator pt-2.5">
                <div>
                  <dt className="text-meta text-muted-foreground">{labels.domain}</dt>
                  <dd dir="ltr" className="mt-0.5 break-all font-semibold text-foreground">
                    {externalUrl?.host ?? labels.invalidUrl}
                  </dd>
                </div>
                <div>
                  <dt className="text-meta text-muted-foreground">{labels.url}</dt>
                  <dd
                    dir="ltr"
                    className="mt-0.5 select-text break-all font-mono text-label text-foreground"
                  >
                    {request.url}
                  </dd>
                </div>
              </dl>
            ) : null}
            {suspicious ? (
              <p className="mt-2 text-label text-muted-foreground">{labels.suspicious}</p>
            ) : null}
            {request.mode === "unsupported" ? (
              <p className="mt-2 text-label text-muted-foreground">{labels.unsupported}</p>
            ) : null}
          </ConfirmationRequest>
          {request.status === "expired" ? (
            <ConfirmationRejected>{labels.expired}</ConfirmationRejected>
          ) : (
            <>
              {!interactive ? (
                <p className="mt-2 text-label text-muted-foreground">{labels.inactive}</p>
              ) : null}
              <ConfirmationActions>
                <DismissActions canSubmit={canSubmit} labels={labels} resolve={resolve} />
                {request.mode === "url" ? (
                  <ConfirmationAction
                    disabled={!canSubmit || !externalUrl}
                    tone="primary"
                    type="button"
                    onClick={() => {
                      if (externalUrl)
                        void resolve({ action: "accept" }, () => openUrl(externalUrl.href));
                    }}
                  >
                    <ExternalLink aria-hidden="true" />
                    {labels.open}
                  </ConfirmationAction>
                ) : null}
              </ConfirmationActions>
            </>
          )}
        </>
      )}
    </Confirmation>
  );
}

/** 两端共享问卷与同意界面，由宿主处理打开方式及回传格式。 */
export function ElicitationRequestCard(props: Props) {
  const { request, asyncQuestionLabels } = props;
  if (request.mode === "form" && request.acp && request.codexAsyncQuestion && asyncQuestionLabels) {
    const questions = readCodexAsyncQuestions(request.fields);
    if (questions)
      return (
        <AsyncQuestionCard
          {...props}
          questions={questions}
          asyncQuestionLabels={asyncQuestionLabels}
        />
      );
  }
  return props.request.mode === "form" ? (
    <FormCard {...props} request={props.request} />
  ) : (
    <ConfirmationCard {...props} />
  );
}

function AsyncQuestionCard(
  props: Props & {
    questions: NonNullable<ReturnType<typeof readCodexAsyncQuestions>>;
    asyncQuestionLabels: CodexAsyncQuestionLabels;
  },
) {
  const { canSubmit, resolve, submitting } = useResolution(props);
  const feedback =
    props.request.status === "expired"
      ? props.labels.expired
      : props.interactive
        ? undefined
        : props.labels.inactive;
  return (
    <CodexAsyncQuestionnaire
      questions={props.questions}
      labels={props.asyncQuestionLabels}
      navigation={props.questionnaireLabels}
      disabled={!canSubmit}
      submitting={submitting}
      feedback={feedback}
      onSubmit={(content) => void resolve({ action: "accept", content })}
      onClose={() => void resolve({ action: "cancel" })}
    />
  );
}

export function isVisibleElicitationStatus(
  request: { type: string },
  latestTurnId: string | undefined,
): boolean {
  return (
    latestTurnId !== undefined &&
    "turnId" in request &&
    request.turnId === latestTurnId &&
    request.type === "mcp_elicitation" &&
    "mode" in request &&
    request.mode === "url" &&
    "externalStatus" in request &&
    request.externalStatus !== undefined
  );
}
