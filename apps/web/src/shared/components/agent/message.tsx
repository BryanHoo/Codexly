import { useTranslation } from "../../../i18n/i18n.js";
import {
  MessageBranchNext as SharedMessageBranchNext,
  MessageBranchPrevious as SharedMessageBranchPrevious,
  type MessageBranchNextProps,
  type MessageBranchPreviousProps,
} from "@codexly/ui/agent/message";

export * from "@codexly/ui/agent/message";

export function MessageBranchPrevious(props: MessageBranchPreviousProps) {
  const { t } = useTranslation("conversation");
  return (
    <SharedMessageBranchPrevious aria-label={t("agentComponents.previousBranch")} {...props} />
  );
}

export function MessageBranchNext(props: MessageBranchNextProps) {
  const { t } = useTranslation("conversation");
  return <SharedMessageBranchNext aria-label={t("agentComponents.nextBranch")} {...props} />;
}
