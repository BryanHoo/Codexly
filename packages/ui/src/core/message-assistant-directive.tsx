import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { GitBranch, MessageCircle } from "lucide-react";
import {
  getAssistantDirectiveLink,
  type AssistantDirectiveLink,
} from "@codexly/frontend-core/assistant-directive-links";
import { Button } from "./button.js";

const FollowupContext = createContext<((prompt: string) => void) | null>(null);

export function renderAssistantDirectiveLink(
  href: string | undefined,
  children: ReactNode,
  getLabel: (key: AssistantDirectiveLink["kind"] | "git-create-pr-draft") => string,
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, url: string) => void,
) {
  const directive = getAssistantDirectiveLink(href);
  if (directive === null) return null;
  const key =
    directive.kind === "git-create-pr" && directive.isDraft
      ? "git-create-pr-draft"
      : directive.kind;
  return (
    <MessageAssistantDirective
      directive={directive}
      label={getLabel(key)}
      {...(onNavigate === undefined ? {} : { onNavigate })}
    >
      {children}
    </MessageAssistantDirective>
  );
}

export function MessageFollowupProvider({
  children,
  onSelect,
}: Readonly<{ children?: ReactNode; onSelect: ((prompt: string) => void) | null }>) {
  return <FollowupContext.Provider value={onSelect}>{children}</FollowupContext.Provider>;
}

export function MessageAssistantDirective({
  children,
  directive,
  label,
  onNavigate,
}: Readonly<{
  children: ReactNode;
  directive: AssistantDirectiveLink;
  label: string;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, url: string) => void;
}>) {
  const selectFollowup = useContext(FollowupContext);
  if (directive.kind === "followup") {
    const content = (
      <>
        <MessageCircle aria-hidden="true" className="size-3.5 shrink-0" />
        <span>{children}</span>
      </>
    );
    return selectFollowup === null ? (
      <span data-codex-followup="true" className="inline-flex items-center gap-1.5">
        {children}
      </span>
    ) : (
      <Button
        variant="outline"
        size="sm"
        className="my-1 h-auto max-w-full whitespace-normal py-1.5 text-left"
        data-codex-followup="true"
        title={label}
        onClick={() => {
          selectFollowup(directive.prompt);
        }}
        type="button"
      >
        {content}
      </Button>
    );
  }
  const content = (
    <>
      <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{label}</span>
      {directive.branch ? (
        <span className="max-w-48 truncate font-mono text-caption">{directive.branch}</span>
      ) : null}
    </>
  );
  const className =
    "my-1 inline-flex max-w-full items-center gap-1.5 rounded-control border border-separator px-2 py-1 text-label text-muted-foreground align-middle";
  return directive.kind === "git-create-pr" && directive.url !== undefined ? (
    <a
      className={`${className} text-brand hover:bg-control-hover`}
      data-codex-git-receipt={directive.kind}
      href={directive.url}
      title={directive.cwd}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => onNavigate?.(event, directive.url ?? "")}
    >
      {content}
    </a>
  ) : (
    <span className={className} data-codex-git-receipt={directive.kind} title={directive.cwd}>
      {content}
    </span>
  );
}
