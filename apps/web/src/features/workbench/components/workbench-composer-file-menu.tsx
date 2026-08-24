import { File } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from "../../../shared/components/agent/prompt-input.js";
import type { WorkbenchComposerViewProps } from "./workbench-composer-view-contracts.js";

function parentPath(path: string, name: string): string {
  const parent = path.slice(0, Math.max(0, path.length - name.length)).replace(/\/$/u, "");
  return parent === "" ? "." : parent;
}

export function ComposerFileMenu({ props }: Readonly<{ props: WorkbenchComposerViewProps }>) {
  const { t } = useTranslation("workbench");
  if (!props.fileMenuOpen || props.turnControlsDisabled) {
    return null;
  }
  return (
    <PromptInputCommand
      aria-label={t("composer.fileSearch")}
      className="absolute inset-x-0 bottom-full z-20 mb-2"
      id={props.commandMenuId}
    >
      <PromptInputCommandList>
        {props.fileSearchPending ? (
          <PromptInputCommandEmpty>{t("composer.fileSearchLoading")}</PromptInputCommandEmpty>
        ) : props.fileSearchError !== null ? (
          <PromptInputCommandEmpty>{t("composer.fileSearchFailed")}</PromptInputCommandEmpty>
        ) : props.fileSearchResults.length === 0 ? (
          <PromptInputCommandEmpty>{t("composer.fileSearchEmpty")}</PromptInputCommandEmpty>
        ) : (
          <PromptInputCommandGroup label={t("composer.fileSearchGroup")}>
            {props.fileSearchResults.map((file, index) => (
              <PromptInputCommandItem
                active={index === props.activeCommandIndex}
                id={`${props.commandMenuId}-item-${String(index)}`}
                key={file.path}
                onClick={() => {
                  props.onSelectFileReference(file);
                }}
              >
                <File aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 font-medium text-foreground">{file.name}</span>
                  <span className="min-w-0 truncate text-caption text-muted-foreground">
                    {parentPath(file.path, file.name)}
                  </span>
                </span>
              </PromptInputCommandItem>
            ))}
          </PromptInputCommandGroup>
        )}
      </PromptInputCommandList>
    </PromptInputCommand>
  );
}
