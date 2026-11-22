import type { AgentItem } from "@codexly/protocol";
import { ChevronRight, Network } from "lucide-react";
import { useState, type ReactNode } from "react";

type Subagent = Extract<AgentItem, { type: "acp_subagent" }>;
interface Transcript {
  key: string;
  session: Subagent;
  itemKeys: string[];
  children: Transcript[];
}

/** 按不可变的条目身份分组。未展开的子会话不会订阅任何正文增量。 */
export function splitAcpSubagentItems(
  keys: readonly string[],
  read: (key: string) => Subagent | { type: string; id: string } | undefined,
) {
  const rootKeys: string[] = [];
  const byId = new Map<string, Transcript>();
  const byPrefix = new Map<string, Transcript>();
  for (const key of keys) {
    const item = read(key);
    if (item?.type !== "acp_subagent" || !("sessionId" in item)) continue;
    const transcript = { key, session: item, itemKeys: [], children: [] };
    byId.set(item.sessionId, transcript);
    byPrefix.set(item.id, transcript);
  }
  const transcripts: Transcript[] = [];
  for (const transcript of byId.values()) {
    const parent = byId.get(transcript.session.parentSessionId);
    if (parent) parent.children.push(transcript);
    else transcripts.push(transcript);
  }
  for (const key of keys) {
    const item = read(key);
    if (item?.type === "acp_subagent") continue;
    const prefix = item?.id.startsWith("acp:child:")
      ? item.id.slice(0, item.id.indexOf(":", "acp:child:".length) + 1)
      : "";
    const transcript = byPrefix.get(prefix);
    if (transcript) transcript.itemKeys.push(key);
    else if (!prefix) rootKeys.push(key);
  }
  return { rootKeys, transcripts };
}

export function AcpSubagentTranscripts({
  transcripts,
  label,
  renderItem,
}: Readonly<{
  transcripts: readonly Transcript[];
  label: (index: number) => string;
  renderItem: (key: string) => ReactNode;
}>) {
  return transcripts.length ? (
    <div className="space-y-2">
      {transcripts.map((transcript, index) => (
        <SubagentTranscript
          key={transcript.session.sessionId}
          transcript={transcript}
          fallback={label(index + 1)}
          label={label}
          renderItem={renderItem}
        />
      ))}
    </div>
  ) : null;
}

function SubagentTranscript({
  transcript,
  fallback,
  label,
  renderItem,
}: Readonly<{
  transcript: Transcript;
  fallback: string;
  label: (index: number) => string;
  renderItem: (key: string) => ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const { session, key, itemKeys, children } = transcript;
  return (
    <details
      className="group/subagent min-w-0 rounded-md border border-separator"
      data-conversation-anchor={key}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-label text-foreground hover:bg-control focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 group-open/subagent:rotate-90"
        />
        <Network aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words">{session.title ?? fallback}</span>
      </summary>
      {open ? (
        <div className="agent-timeline min-w-0 space-y-2 border-t border-separator px-3 py-2">
          {session.description ? (
            <p className="break-words text-meta text-muted-foreground">{session.description}</p>
          ) : null}
          {itemKeys.map(renderItem)}
          <AcpSubagentTranscripts transcripts={children} label={label} renderItem={renderItem} />
        </div>
      ) : null}
    </details>
  );
}
