import type { ReactNode } from "react";
import { FileCode2, Image, X } from "lucide-react";
import {
  CodeBlockActions,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "../../../shared/components/agent/code-block.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";

export function getFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

export type SourceHeaderProps = Readonly<{
  actions?: ReactNode;
  lineNumber: number | null;
  onClose?: () => void;
  previewKind: "image" | "source" | "pdf";
  sourcePath: string;
  sourceStatus: "error" | "loading" | "partial" | null;
}>;

export function SourceHeader({
  actions,
  lineNumber,
  onClose,
  previewKind,
  sourcePath,
  sourceStatus,
}: SourceHeaderProps) {
  const { t } = useTranslation("workbench");
  return (
    <CodeBlockHeader className="min-h-toolbar gap-3 overflow-hidden bg-raised px-3 shadow-toolbar sm:px-4">
      <CodeBlockTitle className="w-0 flex-1 overflow-hidden">
        {previewKind === "image" ? (
          <Image className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-0 flex-1 overflow-hidden">
              <h2 className="truncate text-body-small font-semibold">
                <CodeBlockFilename>
                  {getFileName(sourcePath)}
                  {lineNumber === null ? null : ` (line ${String(lineNumber)})`}
                </CodeBlockFilename>
              </h2>
              <p className="truncate text-caption text-muted-foreground">{sourcePath}</p>
            </div>
          </TooltipTrigger>
          <TooltipContent className="break-all">{sourcePath}</TooltipContent>
        </Tooltip>
      </CodeBlockTitle>
      {sourceStatus === null ? null : (
        <span
          className={`shrink-0 text-label ${sourceStatus === "error" ? "text-danger" : "text-warning"}`}
          role={sourceStatus === "error" ? "alert" : "status"}
        >
          {t(
            sourceStatus === "loading"
              ? "projectDialog.loadingMoreSource"
              : sourceStatus === "error"
                ? "projectDialog.loadMoreSourceError"
                : "projectDialog.sourcePartial",
          )}
        </span>
      )}
      <CodeBlockActions>
        {actions}
        {onClose === undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t(
                  previewKind === "pdf"
                    ? "projectDialog.closePdfPreview"
                    : previewKind === "image"
                      ? "projectDialog.closeImagePreview"
                      : "projectDialog.closeSource",
                )}
                onClick={onClose}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t(
                previewKind === "pdf"
                  ? "projectDialog.closePdfPreview"
                  : previewKind === "image"
                    ? "projectDialog.closeImagePreview"
                    : "projectDialog.closeSource",
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </CodeBlockActions>
    </CodeBlockHeader>
  );
}
