# 项目工程指南

## 使用方式

根据变更范围读取 `frontend`、`backend` 或 `shared` 的索引和相关细则。跨层修改同时读取 [跨层思考](./cross-layer-thinking-guide.md)，复用判断读取 [代码复用](./code-reuse-thinking-guide.md)，脚本与平台行为读取 [跨平台思考](./cross-platform-thinking-guide.md)。

## 验证

- 快速反馈使用相关 Vitest 文件、`pnpm run typecheck` 和 `pnpm run lint`。
- 跨包边界变更增加 `pnpm run lint:architecture`。
- 发布级验证使用 `pnpm run check`；端到端行为使用 `pnpm run test:e2e`。

## 更新触发条件

- 引入新的跨包约束或稳定目录规则。
- 同类缺陷重复出现，需要固化预防规则。
- 项目验证命令、运行时边界或工具链发生变化。
