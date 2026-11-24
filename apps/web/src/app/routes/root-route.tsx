import { useProductName } from "@codexly/ui/core/product-brand";
import { Link, Outlet, createRootRoute, useMatch } from "@tanstack/react-router";
import { useEffect } from "react";

import { productNamePreference } from "../../features/settings/product-name-preference.js";
import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { NotFound } from "./not-found.js";

export const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});

function RouteError({ error, reset }: Readonly<{ error: Error; reset: () => void }>) {
  const { t } = useTranslation("common");
  return (
    <main
      className="grid h-full place-items-center bg-window px-6"
      aria-labelledby="route-error-title"
    >
      <section className="w-full max-w-lg rounded-surface bg-raised p-6 shadow-panel">
        <p className="mb-2 text-xs font-semibold text-danger uppercase">
          {t("errors.routeErrorLabel")}
        </p>
        <h1 id="route-error-title" className="text-xl font-semibold text-foreground">
          {t("errors.routeErrorTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <Button
          variant="ghost"
          className="mt-5 rounded-control bg-control px-3 py-2 text-body font-medium text-foreground shadow-sm transition-colors hover:bg-control-hover"
          onClick={reset}
          type="button"
        >
          {t("actions.retry")}
        </Button>
      </section>
    </main>
  );
}

function RootLayout() {
  return (
    <div className="h-full min-h-0 bg-window text-foreground" data-testid="app-root">
      <ProductDocumentTitle />
      <Outlet />
    </div>
  );
}

function ProductDocumentTitle() {
  const name = useProductName(productNamePreference);
  const isFilePopup = useMatch({
    from: "/p/$projectId/file",
    shouldThrow: false,
    select: () => true,
  });
  useEffect(() => {
    // 独立文件窗口沿用文件标题，返回工作台时恢复已保存的产品名。
    if (!isFilePopup) document.title = name;
  }, [isFilePopup, name]);
  return null;
}

export function BrandLink() {
  return (
    <Link className="inline-flex items-center" to="/">
      <img
        alt="Codexly"
        className="h-7 w-auto"
        height="28"
        src="/brand/codexly-logo.svg"
        width="116"
      />
    </Link>
  );
}
