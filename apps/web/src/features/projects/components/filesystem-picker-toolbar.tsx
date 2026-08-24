import type { ProjectDirectoryListing } from "@code-agent/protocol";
import { ArrowRight, ArrowUp, Eye, EyeOff } from "lucide-react";

import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/components/core/select.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { findActiveFilesystemRoot } from "../../../shared/lib/filesystem-roots.js";

type FilesystemPickerListing = Pick<ProjectDirectoryListing, "parentPath" | "path" | "roots">;

export type FilesystemPickerToolbarLabels = Readonly<{
  filesystemRoot: string;
  goToPath: string;
  hideHidden: string;
  parent: string;
  pathLabel: string;
  pathPlaceholder: string;
  showHidden: string;
}>;

type FilesystemPickerToolbarProps = Readonly<{
  disabled: boolean;
  includeHidden: boolean;
  labels: FilesystemPickerToolbarLabels;
  listing: FilesystemPickerListing | undefined;
  onNavigateParent: () => void;
  onNavigatePath: () => void;
  onNavigateRoot: (path: string) => void;
  onPathChange: (path: string) => void;
  onToggleHidden: () => void;
  path: string;
}>;

export function FilesystemPickerToolbar({
  disabled,
  includeHidden,
  labels,
  listing,
  onNavigateParent,
  onNavigatePath,
  onNavigateRoot,
  onPathChange,
  onToggleHidden,
  path,
}: FilesystemPickerToolbarProps) {
  const activeRootPath =
    listing === undefined ? undefined : findActiveFilesystemRoot(listing.roots, listing.path)?.path;
  const hiddenAction = includeHidden ? labels.hideHidden : labels.showHidden;

  return (
    <div className="flex min-h-10 items-center gap-2 border-y border-separator bg-panel px-3 sm:px-4">
      {listing === undefined || listing.roots.length < 2 ? null : (
        <Select
          disabled={disabled}
          onValueChange={onNavigateRoot}
          {...(activeRootPath === undefined ? {} : { value: activeRootPath })}
        >
          <SelectTrigger
            aria-label={labels.filesystemRoot}
            className="h-8 min-w-20 px-2 font-mono"
            size="sm"
          >
            <SelectValue placeholder={labels.filesystemRoot} />
          </SelectTrigger>
          <SelectContent position="popper">
            {listing.roots.map((root) => (
              <SelectItem key={root.path} value={root.path}>
                {root.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={labels.parent}
            disabled={listing?.parentPath === null || listing === undefined || disabled}
            onClick={onNavigateParent}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{labels.parent}</TooltipContent>
      </Tooltip>
      <form
        className="flex min-w-0 flex-1 items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          onNavigatePath();
        }}
      >
        <Input
          aria-label={labels.pathLabel}
          autoComplete="off"
          className="h-8 min-w-0 px-2 font-mono text-caption max-workbench:h-11"
          disabled={disabled}
          onChange={(event) => {
            onPathChange(event.target.value);
          }}
          placeholder={labels.pathPlaceholder}
          spellCheck={false}
          value={path}
          variant="compact"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={labels.goToPath}
              disabled={path.trim().length === 0 || disabled}
              size="icon-sm"
              type="submit"
              variant="ghost"
            >
              <ArrowRight aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{labels.goToPath}</TooltipContent>
        </Tooltip>
      </form>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={hiddenAction}
            aria-pressed={includeHidden}
            disabled={disabled}
            onClick={onToggleHidden}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {includeHidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{hiddenAction}</TooltipContent>
      </Tooltip>
    </div>
  );
}
