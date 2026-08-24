import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMcpServer } from "@code-agent/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { WorkbenchInspector as WorkbenchInspectorComponent } from "./workbench-inspector.js";

// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export function WorkbenchInspector(
  props: Omit<ComponentProps<typeof WorkbenchInspectorComponent>, "projectRootId">,
) {
  return <WorkbenchInspectorComponent {...props} projectRootId="root-code-agent" />;
}

export function renderInspectorMarkup(children: ReactNode): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  );
}

export const gitStatus = {
  baseBranches: ["origin/main"],
  branch: "feat/review",
  branches: ["feat/review", "main"],
  repositoryMode: "root" as const,
  snapshot: "a".repeat(64),
  staged: [
    {
      diff: "--- a/package.json\n+++ b/package.json\n@@ -1,1 +1,2 @@\n-old\n+new\n+next",
      kind: "update" as const,
      path: "package.json",
    },
  ],
  unstaged: [
    {
      diff: "--- /dev/null\n+++ b/new-file.ts\n@@ -0,0 +1,1 @@\n+export {};",
      kind: "create" as const,
      path: "new-file.ts",
    },
  ],
};

export const lightweightGitStatus = {
  ...gitStatus,
  staged: gitStatus.staged.map((change) => ({ ...change, diff: "" })),
  unstaged: gitStatus.unstaged.map((change) => ({ ...change, diff: "" })),
};

export const nestedGitStatus = {
  baseBranches: ["origin/main"],
  branch: "feat/tree-status",
  branches: ["feat/tree-status", "main"],
  repositoryMode: "root" as const,
  snapshot: "b".repeat(64),
  staged: [],
  unstaged: [
    {
      diff: "--- a/src/components/app.tsx\n+++ b/src/components/app.tsx\n@@ -1,1 +1,2 @@\n-old\n+new\n+next",
      kind: "update" as const,
      path: "src/components/app.tsx",
    },
  ],
};

export const readyMcpServer = {
  authStatus: "oAuth",
  description: "Semantic repository search",
  error: null,
  failureReason: null,
  name: "fast-context",
  status: "ready",
  title: "Fast Context",
  toolCount: 2,
  version: "1.2.0",
} as const satisfies AgentMcpServer;

export function readInspectorTabLabels(markup: string): string[] {
  return [...markup.matchAll(/role="tab"[^>]*>.*?<span>([^<]+)<\/span><\/button>/gsu)].map(
    (match) => match[1] ?? "",
  );
}
