import { File, Presentation } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import type { MessageFileReference, MessageFileReferenceOpenMode } from "../agent/message.js";
import { Button } from "./button.js";

export function MessageFileCitation({
  path,
  openLabel,
  onOpen,
  ...props
}: Readonly<
  ComponentProps<typeof Button> & {
    path: string;
    openLabel: string;
    onOpen: ((reference: MessageFileReference, mode?: MessageFileReferenceOpenMode) => void) | null;
  }
>): ReactElement<ComponentProps<typeof Button>> {
  const name = path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
  const extension = name.includes(".") ? name.split(".").at(-1)?.toUpperCase() : undefined;
  const Icon = extension === "PPTX" || extension === "PPT" ? Presentation : File;
  return (
    <Button
      {...props}
      variant="ghost"
      className="my-1 inline-flex h-auto max-w-full min-w-0 justify-start gap-3 rounded-xl border border-separator bg-panel px-4 py-3 text-left text-foreground align-middle whitespace-normal hover:bg-control-hover"
      data-file-citation="true"
      disabled={onOpen === null}
      onClick={() => {
        // 产物卡片始终走宿主的系统默认应用通道，不读取或传输整份文件。
        onOpen?.({ lineNumber: null, path }, "system-default");
      }}
      title={`${openLabel}: ${path}`}
      type="button"
    >
      <Icon aria-hidden="true" className="size-7 shrink-0 text-brand" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        <span className="block text-caption text-muted-foreground">
          {extension ? `${extension} · ` : ""}
          {openLabel}
        </span>
      </span>
    </Button>
  );
}
