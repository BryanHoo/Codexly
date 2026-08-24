import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { ProviderConnectionPanel } from "./provider-connection-panel.js";
import { providerConnectionQueryOptions } from "../provider-connection-queries.js";

export function ProviderConnectionGate({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useTranslation("settings");
  const connection = useQuery(providerConnectionQueryOptions());

  if (connection.data?.state === "connected") {
    return children;
  }
  if (connection.isPending) {
    return (
      <main className="grid h-full min-h-0 place-items-center bg-window text-body-small text-muted-foreground">
        {t("provider.loading")}
      </main>
    );
  }
  return (
    <main className="h-full min-h-0 overflow-y-auto bg-window px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-[42rem]">
        <header className="mb-8 border-b border-separator pb-5">
          <h1 className="text-xl font-semibold text-foreground">CodeAgent</h1>
          <p className="mt-1 text-body-small text-muted-foreground">{t("provider.title")}</p>
        </header>
        {connection.error === null ? (
          <ProviderConnectionPanel />
        ) : (
          <div className="grid justify-items-start gap-3" role="alert">
            <p className="text-body-small text-danger">{t("provider.errors.load")}</p>
            <Button onClick={() => void connection.refetch()} type="button" variant="outline">
              {t("provider.retry")}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
