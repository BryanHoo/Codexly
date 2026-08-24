import { useQuery } from "@tanstack/react-query";
import { FileCode2, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "../../../shared/components/agent/code-block.js";
import { getCodeLanguage } from "../../../shared/components/agent/code-languages.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../../../shared/components/core/dialog.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { MAX_MESSAGE_SOURCE_ATTACHMENT_BYTES } from "../project-file-reference.js";

async function readSourceAttachment(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) {
    throw new Error(`Attachment request failed with HTTP ${String(response.status)}`);
  }
  const content = await response.arrayBuffer();
  if (content.byteLength > MAX_MESSAGE_SOURCE_ATTACHMENT_BYTES) {
    throw new RangeError("Attachment is too large to preview");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(content);
}

export function MessageSourceAttachment({
  name,
  triggerChildren,
  triggerClassName,
  url,
}: Readonly<{
  name: string;
  triggerChildren: ReactNode;
  triggerClassName: string;
  url: string;
}>) {
  useTranslation("conversation");
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const sourceQuery = useQuery({
    enabled: isOpen,
    queryFn: ({ signal }) => readSourceAttachment(url, signal),
    queryKey: ["task-attachment-source", url] as const,
    staleTime: 30_000,
  });
  const closeLabel = i18n.t("projectDialog.closeSource", { ns: "workbench" });

  return (
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogTrigger asChild>
        <Button
          aria-label={i18n.t("timeline.openAttachment", { name, ns: "conversation" })}
          className={triggerClassName}
          data-attachment-open="source"
          type="button"
          variant="ghost"
        >
          {triggerChildren}
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-labelledby={titleId}
        className="h-[min(82dvh,54rem)] max-w-[72rem] overflow-hidden p-0"
      >
        {sourceQuery.data === undefined ? (
          <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
            <header className="flex min-h-toolbar items-center gap-3 px-3 shadow-toolbar sm:px-4">
              <FileCode2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <DialogTitle className="min-w-0 flex-1 truncate text-body-small" id={titleId}>
                {name}
              </DialogTitle>
              <AttachmentSourceCloseButton
                label={closeLabel}
                onClose={() => {
                  setIsOpen(false);
                }}
              />
            </header>
            <div
              className={`grid min-h-0 place-items-center text-body-small ${
                sourceQuery.error === null ? "text-muted-foreground" : "text-danger"
              }`}
              role={sourceQuery.error === null ? "status" : "alert"}
            >
              {i18n.t(
                sourceQuery.error === null
                  ? "projectDialog.loadingSource"
                  : "projectDialog.loadSourceError",
                { ns: "workbench" },
              )}
            </div>
          </section>
        ) : (
          <CodeBlock
            className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-none bg-content shadow-none"
            code={sourceQuery.data}
            language={getCodeLanguage(name)}
            showLineNumbers
          >
            <CodeBlockHeader className="min-h-toolbar gap-3 bg-raised px-3 shadow-toolbar sm:px-4">
              <CodeBlockTitle className="min-w-0 flex-1">
                <FileCode2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <DialogTitle asChild>
                  <h2 className="truncate text-body-small font-semibold" id={titleId} title={name}>
                    <CodeBlockFilename>{name}</CodeBlockFilename>
                  </h2>
                </DialogTitle>
              </CodeBlockTitle>
              <CodeBlockActions>
                <CodeBlockCopyButton />
                <AttachmentSourceCloseButton
                  label={closeLabel}
                  onClose={() => {
                    setIsOpen(false);
                  }}
                />
              </CodeBlockActions>
            </CodeBlockHeader>
          </CodeBlock>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AttachmentSourceCloseButton({
  label,
  onClose,
}: Readonly<{ label: string; onClose: () => void }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} onClick={onClose} size="icon-sm" type="button" variant="ghost">
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
