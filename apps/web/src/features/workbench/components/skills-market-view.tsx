import { LoadingSkeleton } from "@codexly/ui/core/loading-skeleton";
import { lazy, Suspense } from "react";
import { useTranslation } from "../../../i18n/i18n.js";

const LazySkillsMarketContainer = lazy(() =>
  import("../../skills-market/skills-market-container.js").then((module) => ({
    default: module.SkillsMarketContainer,
  })),
);

export function SkillsMarketView(
  props: Readonly<{
    onSectionChange?: (section: "mcp" | "plugins" | "skills") => void;
    section?: string;
  }>,
) {
  const { t } = useTranslation("workbench");
  return (
    <Suspense
      fallback={
        <LoadingSkeleton
          variant="list"
          className="flex-1 p-6"
          label={t("skillsMarket.loadingExtension")}
        />
      }
    >
      <LazySkillsMarketContainer {...props} />
    </Suspense>
  );
}
