import { useState } from "react";

import { Button } from "./button.js";

export type PdfPreviewLabels = Readonly<{
  open: string;
  unavailable: string;
}>;

export function PdfPreview({
  name,
  src,
  labels,
  onOpen,
}: Readonly<{
  name: string;
  src: string;
  labels: PdfPreviewLabels;
  onOpen?: () => void;
}>) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const browserNavigator = typeof navigator === "undefined" ? undefined : navigator;
  const supported = Boolean(browserNavigator?.pdfViewerEnabled);
  return (
    <div className="flex h-full min-h-0 flex-col bg-content" data-pdf-preview="">
      {supported && failedSrc !== src ? (
        // 原生查看器直接读取资源；不增加 PDF.js、Canvas 或整文件内存副本。
        <iframe
          className="min-h-0 w-full flex-1 border-0"
          key={src}
          onError={() => {
            setFailedSrc(src);
          }}
          src={src}
          title={name}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
          <p className="text-body-small text-muted-foreground" role="status">
            {labels.unavailable}
          </p>
          {onOpen === undefined ? (
            <a
              className="rounded-control px-3 py-1 text-body-small text-brand"
              href={src}
              rel="noopener noreferrer"
              target="_blank"
            >
              {labels.open}
            </a>
          ) : (
            <Button onClick={onOpen} size="sm" variant="ghost">
              {labels.open}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
