# 前端质量规范

## Purpose

Capture review and verification standards for this project.

## 检查

- 行为变更添加相邻 Vitest 测试；跨页面关键流程添加或更新 `tests/e2e` Playwright 测试。
- 交互控件验证键盘操作、焦点、可访问名称以及窄屏布局。
- 前端变更至少运行相关测试、`pnpm run typecheck` 和 `pnpm run lint`。
- 构建或依赖变更运行 `pnpm run build` 与 `pnpm run bundle:check`。
- Web 生产构建必须在写入前清理独立输出目录，避免旧哈希资源累积并被重复预压缩。
- Vite 原始 Chunk 警告阈值保持为 512 kB，仅容纳不可继续切分的单模块 Grammar；传输体积仍由 `bundle:check` 的 gzip 预算约束。
- Web Bundle 门禁限制首屏、工作台就绪和最大异步组的 gzip 体积；请求数仅保留报告观测，不作为失败条件。
- Skills 市场、定时任务等非首屏管理页按功能异步加载组件和样式，重型日期弹层继续二次异步加载；变更后使用 `bundle:check` 和对应 Playwright 关键流程验证。
