import { ComposerInteractionBoundary as SharedBoundary } from "@codexly/ui/core/composer-interaction-boundary";
import type { ComponentProps } from "react";
import { useTranslation } from "../../../i18n/i18n.js";

export function ComposerInteractionBoundary(props: Omit<ComponentProps<typeof SharedBoundary>, "message">) {
  const { t } = useTranslation("workbench");
  return <SharedBoundary {...props} message={t("composer.threadBusy")} />;
}
