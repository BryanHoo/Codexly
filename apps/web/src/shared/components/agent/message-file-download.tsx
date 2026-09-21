import { createContext, useContext, type ReactNode } from "react";

import type { MessageFileReference } from "./message.js";

export type MessageFileDownload = Readonly<{
  name: string;
  url: string;
}>;

type ResolveMessageFileDownload = (reference: MessageFileReference) => MessageFileDownload | null;

const MessageFileDownloadContext = createContext<ResolveMessageFileDownload | null>(null);

export function MessageFileDownloadProvider({
  children,
  resolveDownload,
}: Readonly<{
  children: ReactNode;
  resolveDownload: ResolveMessageFileDownload | null;
}>) {
  return (
    <MessageFileDownloadContext.Provider value={resolveDownload}>
      {children}
    </MessageFileDownloadContext.Provider>
  );
}

export function useMessageFileDownload(
  reference: MessageFileReference,
): MessageFileDownload | null {
  return useContext(MessageFileDownloadContext)?.(reference) ?? null;
}
