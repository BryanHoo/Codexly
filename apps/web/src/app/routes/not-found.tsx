import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { useTranslation } from "../../i18n/i18n.js";

export function NotFound() {
  const { t } = useTranslation("common");
  return (
    <main
      className="grid h-full place-items-center bg-window px-6"
      aria-labelledby="not-found-title"
    >
      <section className="w-full max-w-md rounded-surface bg-raised p-6 shadow-panel">
        <p className="mb-2 font-mono text-xs text-warning">404</p>
        <h1 id="not-found-title" className="text-xl font-semibold">
          {t("errors.notFoundTitle")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t("errors.notFoundDescription")}
        </p>
        <Link
          className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-brand-strong"
          to="/"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("actions.backToWorkbench")}
        </Link>
      </section>
    </main>
  );
}
