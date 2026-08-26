# 前端质量规范

## Purpose

Capture review and verification standards for this project.

## 检查

- 行为变更添加相邻 Vitest 测试；跨页面关键流程添加或更新 `tests/e2e` Playwright 测试。
- 交互控件验证键盘操作、焦点、可访问名称以及窄屏布局。
- 前端变更至少运行相关测试、`pnpm run typecheck` 和 `pnpm run lint`。
- 构建或依赖变更运行 `pnpm run build` 与 `pnpm run bundle:check`。
- Web Bundle 门禁限制首屏、工作台就绪和最大异步组的 gzip 体积；请求数仅保留报告观测，不作为失败条件。
