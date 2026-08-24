/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: ["(^|/)(index|main|cli|.*\\.config)\\.[cm]?[jt]sx?$"],
      },
      to: {},
    },
    {
      name: "protocol-is-independent",
      severity: "error",
      from: { path: "^packages/protocol/src" },
      to: { path: "^(packages/(core|provider-codex|server|client)|apps/web|src)" },
    },
    {
      name: "core-only-depends-on-protocol",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: { path: "^(packages/(provider-codex|server|client)|apps/web|src)" },
    },
    {
      name: "provider-does-not-depend-on-delivery",
      severity: "error",
      from: { path: "^packages/provider-codex/src" },
      to: { path: "^(packages/(server|client)|apps/web|src)" },
    },
    {
      name: "client-is-independent-from-server-runtime",
      severity: "error",
      from: { path: "^packages/client/src" },
      to: { path: "^packages/(core|provider-codex|server)/src" },
    },
    {
      name: "web-only-uses-client-and-protocol",
      severity: "error",
      from: { path: "^apps/web/src" },
      to: { path: "^packages/(core|provider-codex|server)/src" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|coverage|node_modules)/" },
    // 分析编译前的 TypeScript 类型依赖，避免纯类型契约被误判为 orphan。
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      conditionNames: ["types", "import", "default"],
      exportsFields: ["exports"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/[^/]+" },
    },
  },
};
