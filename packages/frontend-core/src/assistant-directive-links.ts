import type { AssistantDirective } from "./assistant-directives.js";

export const FOLLOWUP_LINK_PREFIX = "/__codexly_followup__/";
export const GIT_RECEIPT_LINK_PREFIX = "/__codexly_git_receipt__/";
export const GIT_RECEIPT_NAMES = [
  "git-stage",
  "git-commit",
  "git-create-branch",
  "git-push",
  "git-create-pr",
] as const;
export type GitReceiptName = (typeof GIT_RECEIPT_NAMES)[number];
export type AssistantDirectiveLink =
  | Readonly<{ kind: "followup"; prompt: string }>
  | Readonly<{
      kind: GitReceiptName;
      cwd: string;
      branch?: string;
      url?: string;
      isDraft: boolean;
    }>;

function isGitReceiptName(name: string): name is GitReceiptName {
  return GIT_RECEIPT_NAMES.some((candidate) => candidate === name);
}

export function getGitReceipt(directive: AssistantDirective): AssistantDirectiveLink | null {
  if (!isGitReceiptName(directive.name)) return null;
  const cwd = directive.attributes.get("cwd");
  const branch = directive.attributes.get("branch");
  if (
    !cwd?.trim() ||
    (directive.name !== "git-stage" && directive.name !== "git-commit" && !branch?.trim())
  )
    return null;
  const url = directive.attributes.get("url");
  return {
    kind: directive.name,
    cwd,
    ...(branch === undefined ? {} : { branch }),
    // PR 链接只允许标准网页协议；回执展示本身不触发任何 Git 写入。
    ...(url !== undefined && /^https?:\/\//iu.test(url) ? { url } : {}),
    isDraft: directive.attributes.get("isDraft") === "true",
  };
}

export function getAssistantDirectiveLink(href: string | undefined): AssistantDirectiveLink | null {
  try {
    if (href?.startsWith(FOLLOWUP_LINK_PREFIX)) {
      const prompt = decodeURIComponent(
        href.slice(FOLLOWUP_LINK_PREFIX.length).split("#")[0] ?? "",
      );
      return prompt.trim() ? { kind: "followup", prompt } : null;
    }
    if (href?.startsWith(GIT_RECEIPT_LINK_PREFIX)) {
      const value: unknown = JSON.parse(
        decodeURIComponent(href.slice(GIT_RECEIPT_LINK_PREFIX.length)),
      );
      if (typeof value !== "object" || value === null) return null;
      const receipt = value as Record<string, unknown>;
      if (typeof receipt["kind"] !== "string" || typeof receipt["cwd"] !== "string") return null;
      const attributes = new Map<string, string>([["cwd", receipt["cwd"]]]);
      if (typeof receipt["branch"] === "string") attributes.set("branch", receipt["branch"]);
      if (typeof receipt["url"] === "string") attributes.set("url", receipt["url"]);
      if (receipt["isDraft"] === true) attributes.set("isDraft", "true");
      return getGitReceipt({ start: 0, end: 0, name: receipt["kind"], label: null, attributes });
    }
  } catch {
    return null;
  }
  return null;
}
