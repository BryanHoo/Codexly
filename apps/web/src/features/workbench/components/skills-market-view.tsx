import { lazy, Suspense } from "react";

const LazySkillsMarketContainer = lazy(() =>
  import("../../skills-market/skills-market-container.js").then((module) => ({
    default: module.SkillsMarketContainer,
  })),
);

export function SkillsMarketView(props: Readonly<{ projectId?: string; rootPath?: string }>) {
  return (
    <Suspense fallback={<div aria-busy="true" className="flex-1" />}>
      <LazySkillsMarketContainer {...props} />
    </Suspense>
  );
}
