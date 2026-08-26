# 后端质量规范

## 检查

- 用 Vitest 覆盖用例、适配器、错误路径、取消和生命周期清理；性能约束放入 `tests/performance`。
- Fastify 路由使用现有 schema 和统一错误映射，不在 handler 中复制领域规则。
- 包边界变更运行 `pnpm run lint:architecture`，Node 构建运行 `pnpm run build:node` 或完整 `pnpm run build`。
- 发布级变更运行 `pnpm run check`，涉及真实浏览器流程时补充 `pnpm run test:e2e`。
