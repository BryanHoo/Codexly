import { FileCode2 } from "lucide-react";
import { lazy, Suspense } from "react";

import { CodeBlockHeader, CodeBlockTitle } from "../../shared/components/agent/code-block.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../shared/components/core/tooltip.js";
import { useTranslation } from "../../i18n/i18n.js";
import type { AgentFileChange } from "./file-change.js";
import { countFileChangeLines, getFileName } from "./file-change.js";

const PatchDiffViewer = lazy(() => import("./patch-diff-viewer.js"));

export function FileDiffPanel({ change }: Readonly<{ change: AgentFileChange }>) {
  const { t } = useTranslation("workbench");
  const { additions, removals } = countFileChangeLines(change);

  return (
    <section
      aria-label={change.path}
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-raised"
    >
      <CodeBlockHeader className="min-h-toolbar gap-3 overflow-hidden bg-raised px-3 shadow-toolbar sm:px-4">
        <CodeBlockTitle className="w-0 flex-1 overflow-hidden">
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="w-0 flex-1 overflow-hidden">
                <h2 className="truncate text-body-small font-semibold">
                  {getFileName(change.path)}
                </h2>
                <p className="truncate text-caption text-muted-foreground">{change.path}</p>
              </div>
            </TooltipTrigger>
            <TooltipContent className="break-all">{change.path}</TooltipContent>
          </Tooltip>
        </CodeBlockTitle>
        <div className="flex shrink-0 items-center gap-2 text-label font-medium">
          <span className="text-diff-added">+{additions}</span>
          <span className="text-diff-removed">-{removals}</span>
        </div>
      </CodeBlockHeader>
      <div className="min-h-0 min-w-0 overflow-auto bg-content">
        <Suspense
          fallback={
            <div
              className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
              role="status"
            >
              {t("diff.loading")}
            </div>
          }
        >
          <PatchDiffViewer change={change} />
        </Suspense>
      </div>
    </section>
  );
}
