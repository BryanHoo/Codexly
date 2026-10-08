import { useState, type ReactElement, type ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "./button.js";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog.js";
import { PdfPreview, type PdfPreviewLabels } from "./pdf-preview.js";

export function PdfAttachment({
  name,
  src,
  labels,
  className,
  children,
  onOpen,
  wrapTrigger,
}: Readonly<{
  name: string;
  src: string;
  labels: PdfPreviewLabels & Readonly<{ close: string }>;
  className?: string;
  children: ReactNode;
  onOpen?: () => void;
  wrapTrigger?: (trigger: ReactElement) => ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <DialogTrigger asChild>
      <button aria-label={name} className={className} data-message-attachment="pdf" type="button">
        {children}
      </button>
    </DialogTrigger>
  );
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      {wrapTrigger === undefined ? trigger : wrapTrigger(trigger)}
      <DialogContent
        aria-describedby={undefined}
        className="h-[min(92dvh,54rem)] max-w-[72rem] overflow-hidden p-0"
      >
        <section className="grid size-full grid-rows-[auto_minmax(0,1fr)]">
          <header className="flex min-h-toolbar items-center gap-3 px-3 shadow-toolbar">
            <DialogTitle className="min-w-0 flex-1 truncate text-body-small">{name}</DialogTitle>
            <Button
              aria-label={labels.close}
              onClick={() => {
                setOpen(false);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-3.5" />
            </Button>
          </header>
          {/* 只在用户打开弹窗后加载 PDF，历史附件不会提前请求。 */}
          {open ? (
            <PdfPreview
              name={name}
              src={src}
              labels={labels}
              {...(onOpen === undefined ? {} : { onOpen })}
            />
          ) : null}
        </section>
      </DialogContent>
    </Dialog>
  );
}
