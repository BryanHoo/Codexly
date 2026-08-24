import { Box } from "lucide-react";
import type { HTMLAttributes } from "react";

import { promptReferenceTokenClassName } from "../../../shared/components/agent/prompt-reference-token.js";

export const skillTokenClassName = promptReferenceTokenClassName;

type SkillTokenProps = HTMLAttributes<HTMLSpanElement> &
  Readonly<{
    displayName?: string;
    name: string;
  }>;

export function SkillToken({ className = "", displayName, name, ...props }: SkillTokenProps) {
  return (
    <span className={`${skillTokenClassName} ${className}`} {...props}>
      <Box aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{displayName ?? `$${name}`}</span>
    </span>
  );
}
