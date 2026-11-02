import {
  MessageSourceAttachment as SharedMessageSourceAttachment,
  readSourceAttachment,
  type MessageSourceAttachmentProps,
} from "@codexly/ui/core/message-source-attachment";

import { useTranslation } from "../../../i18n/i18n.js";

type Props = Pick<
  MessageSourceAttachmentProps,
  "name" | "triggerChildren" | "triggerClassName" | "url"
>;

export function MessageSourceAttachment(props: Props) {
  const { t } = useTranslation(["conversation", "workbench"]);
  // 文案与平台渲染参数留在端内，共享组件统一处理预览状态和资源生命周期。
  return (
    <SharedMessageSourceAttachment
      {...props}
      legacyTheme={import.meta.env.VITE_MACOS_LEGACY === "true"}
      labels={{
        open: t("timeline.openAttachment", { name: props.name, ns: "conversation" }),
        close: t("projectDialog.closeSource", { ns: "workbench" }),
        loading: t("projectDialog.loadingSource", { ns: "workbench" }),
        error: t("projectDialog.loadSourceError", { ns: "workbench" }),
        copy: t("agentComponents.copyCode", { ns: "conversation" }),
        copied: t("agentComponents.copiedCode", { ns: "conversation" }),
      }}
      readSource={readSourceAttachment}
    />
  );
}
