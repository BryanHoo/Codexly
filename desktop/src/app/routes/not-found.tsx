import { NotFound as SharedNotFound } from "@codexly/ui/core/not-found";
import { Link } from "@tanstack/react-router";

import { useTranslation } from "../../i18n/i18n.js";

export function NotFound() {
  const { t } = useTranslation("common");
  return (
    <SharedNotFound
      backLabel={t("actions.backToWorkbench")}
      description={t("errors.notFoundDescription")}
      renderBackLink={(props) => <Link {...props} to="/" />}
      title={t("errors.notFoundTitle")}
    />
  );
}
