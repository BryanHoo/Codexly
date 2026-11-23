import { RuntimeUnavailable as SharedRuntimeUnavailable } from "@codexly/ui/core/runtime-unavailable";

import { Trans, useTranslation } from "../../../i18n/i18n.js";

export function RuntimeUnavailable({ onRetry }: Readonly<{ onRetry: () => void }>) {
  const { t } = useTranslation("common");
  return (
    <SharedRuntimeUnavailable
      description={
        <Trans
          components={{ command: <code className="font-mono text-foreground" /> }}
          i18nKey="errors.runtimeUnavailableDescription"
          ns="common"
        />
      }
      onRetry={onRetry}
      retryLabel={t("actions.retry")}
      title={t("errors.runtimeUnavailableTitle")}
    />
  );
}
