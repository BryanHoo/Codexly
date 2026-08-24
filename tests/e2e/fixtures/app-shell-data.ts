// 集中维护 App Shell E2E 使用的协议样本。
export const projects = [
  {
    createdAt: "2026-07-22T06:00:00.000Z",
    id: "code-agent",
    name: "CodeAgent",
    roots: [{ id: "root-code-agent", path: "/workspace/CodeAgent" }],
  },
  {
    createdAt: "2026-07-22T06:30:00.000Z",
    id: "superwork",
    name: "superwork",
    roots: [
      { id: "root-superwork", path: "/workspace/superwork" },
      { id: "root-shared", path: "/workspace/shared" },
    ],
  },
];

export const models = [
  {
    defaultReasoningEffort: "high",
    description: "适合复杂编码任务",
    displayName: "GPT-5.6 Sol",
    id: "gpt-5.6-sol",
    isDefault: true,
    supportedReasoningEfforts: [
      { description: "快速回答", id: "low" },
      { description: "深入分析", id: "high" },
    ],
  },
  {
    defaultReasoningEffort: "medium",
    description: "适合日常编码任务",
    displayName: "GPT-5.6 Terra",
    id: "gpt-5.6-terra",
    isDefault: false,
    supportedReasoningEfforts: [
      { description: "快速回答", id: "low" },
      { description: "平衡速度与深度", id: "medium" },
    ],
  },
];

export const customModels = [
  {
    defaultReasoningEffort: "medium",
    description: "",
    displayName: "custom-coder",
    id: "custom-coder",
    isDefault: true,
    supportedReasoningEfforts: [
      { description: "", id: "minimal" },
      { description: "", id: "low" },
      { description: "", id: "medium" },
      { description: "", id: "high" },
      { description: "", id: "xhigh" },
    ],
  },
];

export const skills = [
  {
    description: "审查认证、授权和敏感数据边界",
    displayName: "Security review",
    id: "skill-security",
    name: "review-security",
    scope: "system",
  },
  {
    description: "撰写结构化项目文档",
    displayName: "Documentation writer",
    id: "skill-docs",
    name: "documentation-writer",
    scope: "user",
  },
];

export const mcpServers = ["context7", "chrome-devtools"].map((name) => ({
  authStatus: "unsupported" as const,
  description: null,
  error: null,
  failureReason: null,
  name,
  status: "ready" as const,
  title: null,
  toolCount: 2,
  version: "1.0.0",
}));

export const tasks = [
  {
    id: "task-1",
    pinned: true,
    projectId: "code-agent",
    title: "构建 macOS 工作台",
    updatedAt: "2026-07-22T07:58:00.000Z",
  },
  {
    id: "input-design",
    pinned: false,
    projectId: "code-agent",
    title: "优化输入框交互",
    updatedAt: "2026-07-22T06:00:00.000Z",
  },
  {
    id: "markdown",
    pinned: false,
    projectId: "code-agent",
    title: "完善 Markdown 渲染",
    updatedAt: "2026-07-20T08:00:00.000Z",
  },
  {
    id: "runtime",
    pinned: false,
    projectId: "code-agent",
    title: "完善 Runtime 状态",
    updatedAt: "2026-07-19T08:00:00.000Z",
  },
  {
    id: "provider",
    pinned: false,
    projectId: "code-agent",
    title: "整理 Provider 边界",
    updatedAt: "2026-07-18T08:00:00.000Z",
  },
  {
    id: "protocol",
    pinned: true,
    projectId: "code-agent",
    title: "补充 Protocol 契约",
    updatedAt: "2026-07-17T08:00:00.000Z",
  },
  {
    id: "client",
    pinned: false,
    projectId: "code-agent",
    title: "优化 Client 请求",
    updatedAt: "2026-07-16T08:00:00.000Z",
  },
  {
    id: "plan-check",
    pinned: false,
    projectId: "superwork",
    title: "优化计划预检反馈",
    updatedAt: "2026-07-21T09:00:00.000Z",
  },
];

export const packageJsonDiff = [
  "--- a/package.json",
  "+++ b/package.json",
  "@@ -1,3 +1,3 @@",
  " {",
  '-  "start": "pnpm run dev",',
  '+  "start": "node ./dist/cli.js start",',
  " }",
].join("\n");

export const projectGitStatus = {
  baseBranches: ["origin/main", "main", "release"],
  branch: "feat/review-targets",
  branches: ["feat/review-targets", "main", "release"],
  repositoryMode: "root",
  snapshot: "a".repeat(64),
  staged: [],
  unstaged: [{ diff: packageJsonDiff, kind: "update", path: "package.json" }],
};

export const projectGitWorktrees = [
  {
    branch: "feat/review-targets",
    current: true,
    path: "/workspace/CodeAgent",
  },
  {
    branch: "feat/worktree-review",
    current: false,
    path: "/workspace/CodeAgent-worktree-review",
  },
];

export const projectFileTreeByDirectory = new Map<string | null, object>([
  [
    null,
    {
      entries: [
        { path: "design", type: "directory" },
        { path: "docs", type: "directory" },
        { path: "package.json", type: "file" },
        { path: "100%完成 后续工作交接.pptx", type: "file" },
      ],
      path: null,
    },
  ],
  [
    "design",
    {
      entries: [{ path: "design/result.png", type: "file" }],
      path: "design",
    },
  ],
  [
    "docs",
    {
      entries: [{ path: "docs/architecture-design.md", type: "file" }],
      path: "docs",
    },
  ],
]);

export const projectFileSearchEntries = [
  {
    name: "main.tsx",
    path: "src/main.tsx",
    rootId: "root-code-agent",
    rootPath: "/workspace/CodeAgent",
  },
  {
    name: "main.test.tsx",
    path: "src/main.test.tsx",
    rootId: "root-code-agent",
    rootPath: "/workspace/CodeAgent",
  },
  {
    name: "package.json",
    path: "package.json",
    rootId: "root-code-agent",
    rootPath: "/workspace/CodeAgent",
  },
] as const;

export const projectDirectoryListings = new Map<string | null, object>([
  [
    null,
    {
      entries: [
        { name: "AddedProject", path: "/workspace/AddedProject" },
        { name: "CodeAgent", path: "/workspace/CodeAgent" },
        { name: "superwork", path: "/workspace/superwork" },
      ],
      parentPath: "/",
      path: "/workspace",
      roots: [],
    },
  ],
  [
    "/workspace/AddedProject",
    { entries: [], parentPath: "/workspace", path: "/workspace/AddedProject", roots: [] },
  ],
  [
    "/workspace/ProjectVault",
    {
      entries: [{ name: "VisibleProject", path: "/workspace/ProjectVault/VisibleProject" }],
      parentPath: "/workspace",
      path: "/workspace/ProjectVault",
      roots: [],
    },
  ],
]);

export const taskSnapshot = {
  ...tasks[0],
  contextUsage: { contextWindow: 200_000, usedTokens: 25_000 },
  plan: null,
  pendingRequests: [],
  settings: {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  status: "idle",
  turns: [
    {
      completedAt: "2026-07-22T08:00:00.000Z",
      error: null,
      id: "turn-1",
      items: [
        {
          id: "message-1",
          role: "user",
          skills: [{ name: "review-security" }],
          text: "完成 macOS 原生风格的三栏工作台页面。",
          type: "message",
        },
        {
          content: "保留任务导航、结构化 Agent 时间线与上下文检查器。",
          id: "reasoning-1",
          summary: "分析工作台信息架构",
          type: "reasoning",
        },
        {
          id: "tool-1",
          input: { files: ["docs/web-design.md"] },
          name: "读取 Web 设计规范",
          status: "completed",
          type: "tool",
        },
        {
          changes: [
            {
              diff: packageJsonDiff,
              kind: "update",
              path: "/workspace/CodeAgent/package.json",
            },
          ],
          id: "file-change-1",
          status: "completed",
          type: "file_change",
        },
        {
          id: "message-2",
          role: "assistant",
          text: "工作台界面已按统一的 项目 Agent 组件 结构重新组织。\n\n[architecture-design.md](/workspace/CodeAgent/docs/architecture-design.md:100)\n\n[result.png](/workspace/CodeAgent/design/result.png)\n\n[后续工作交接.pptx](/home/taoye/100%完成/AI 领航/%E5%90%8E%E7%BB%AD%E5%B7%A5%E4%BD%9C%E4%BA%A4%E6%8E%A5.pptx)\n\n[OpenAI](https://openai.com)",
          type: "message",
        },
      ],
      startedAt: "2026-07-22T07:58:00.000Z",
      status: "completed",
    },
  ],
  turnsNextCursor: null,
};

export const taskSnapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "e2e-session" },
  snapshot: taskSnapshot,
};

export const architectureSourceLines = Array.from({ length: 1_440 }, (_, lineIndex) =>
  lineIndex === 99 ? "### 11.7 外部登录边界" : `line ${String(lineIndex + 1)}`,
);

export const architectureSourceFirstPage = `${architectureSourceLines.slice(0, 720).join("\n")}\n`;

export const architectureSourceSecondPage = architectureSourceLines.slice(720).join("\n");

export const architectureSourceNextCursor = 7_200;

export const architectureSourcePreview = architectureSourceFirstPage + architectureSourceSecondPage;
