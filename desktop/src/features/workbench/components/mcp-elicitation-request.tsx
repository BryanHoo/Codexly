import type { McpElicitationResolution, PendingRequest } from "@/protocol/index.js";
import { ElicitationRequestCard } from "@codexly/ui/core/elicitation-request";
import { useRef } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { withAgentLocale } from "../../../shared/components/agent/with-agent-locale.js";
import { notifyActionError, notifyActionSuccess } from "../../notifications/action-notifications.js";
import {
  resolvePendingRequestAttempt,
  type PendingRequestResolutionAttempt,
  type PendingRequestResolveHandler,
} from "./pending-request-resolution.js";
import { openExternalUrl } from "../../../platform/tauri/external-url.js";
const LocalizedCard = /* @__PURE__ */ withAgentLocale(ElicitationRequestCard);

export function McpElicitationRequestCard({ interactive, onResolve, request }: Readonly<{
  interactive: boolean;
  onResolve: PendingRequestResolveHandler;
  request: Extract<PendingRequest, { type: "mcp_elicitation" }>;
}>) {
  const { t } = useTranslation("workbench");
  const { t: qt } = useTranslation("conversation");
  const attempt = useRef<PendingRequestResolutionAttempt>(undefined);
  const title = request.acp
    ? t("pending.acpElicitation", { server: request.serverName })
    : t(request.mode === "form" ? "pending.mcpForm" : "pending.mcpRequest", { server: request.serverName });
  return (
    <LocalizedCard key={request.requestId} interactive={interactive} request={request}
      openUrl={openExternalUrl} onError={notifyActionError}
      onResolve={async (answer) => {
        const resolution: McpElicitationResolution = answer.action === "accept"
          ? (answer.content === undefined ? { action: "accept" } : { action: "accept", content: answer.content })
          : { action: answer.action };
        const next = resolvePendingRequestAttempt(attempt.current, resolution);
        attempt.current = next;
        await onResolve(request, resolution, next.key);
        notifyActionSuccess();
      }}
      questionnaireLabels={{
        previous: qt("questionnaire.previous"),
        next: qt("questionnaire.next"),
        progress: (current, total) => qt("questionnaire.progress", { current, total }),
      }}
      asyncQuestionLabels={{
        pending: qt("asyncQuestions.pending"),
        title: qt("asyncQuestions.pendingCount", { count: 1 }),
        send: qt("asyncQuestions.send"),
        other: qt("asyncQuestions.other"),
        answer: (question) => qt("asyncQuestions.answer", { question }),
        collapse: qt("asyncQuestions.collapse"),
        expand: qt("asyncQuestions.expand"),
        close: qt("asyncQuestions.close"),
      }}
      labels={{
        title,
        submit: t("pending.submitAnswers"), cancel: t("pending.cancel"), decline: t("pending.deny"),
        expired: t("pending.expired"), inactive: t("pending.previousPending"),
        unsupported: t("pending.unsupportedForm"), open: t("pending.openUrl"),
        domain: t("pending.targetDomain"), url: t("pending.targetUrl"),
        suspicious: t("pending.suspiciousUrl"), invalidUrl: t("pending.invalidUrl"),
        opened: t("pending.externalOpened"), completed: t("pending.externalCompleted"),
      }}
    />
  );
}
