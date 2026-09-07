import { lazy, Suspense } from "react";

const LazySkillsMarketContainer = lazy(() =>
  import("../../skills-market/skills-market-container.js").then((module) => ({
    default: module.SkillsMarketContainer,
  })),
);

export function SkillsMarketView(
  props: Readonly<{
    onSectionChange?: (section: "marketplace" | "mcp" | "plugins" | "skills") => void;
    projectId?: string;
    rootPath?: string;
    section?: string;
  }>,
) {
  return (
    <Suspense fallback={<div aria-busy="true" className="flex-1" />}>
      <LazySkillsMarketContainer {...props} />
    </Suspense>
  );
}
