# 前端质量规范

## Purpose

Capture review and verification standards for this project.

## 检查

- 行为变更添加相邻 Vitest 测试；跨页面关键流程添加或更新 `tests/e2e` Playwright 测试。
- 交互控件验证键盘操作、焦点、可访问名称以及窄屏布局。
- 前端变更至少运行相关测试、`pnpm run typecheck` 和 `pnpm run lint`。
- 构建或依赖变更运行 `pnpm run build` 与 `pnpm run bundle:check`。
