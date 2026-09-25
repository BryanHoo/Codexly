import type { HTMLAttributes } from "react";

type SkillTokenProps = HTMLAttributes<HTMLSpanElement> &
  Readonly<{
    displayName?: string;
    name: string;
  }>;

export function SkillToken({ className = "", displayName, name, ...props }: SkillTokenProps) {
  return (
    <span className={className} {...props}>
      {displayName ?? `$${name}`}
    </span>
  );
}
