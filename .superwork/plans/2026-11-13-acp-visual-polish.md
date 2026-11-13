# ACP 紧凑外观与滚动修复

- 根因：Agent 行和按钮重复绘制背景；24px 开关偏大；卡片复用整页骨架且取消留白；ACP 内容由外层 main 统一滚动。
- 修复：复用共享 Switch 的紧凑 20×36 尺寸；单一选中背景；新增字段型骨架；固定弹窗顶部，菜单、Agent、详情分别滚动。
- 边界：双端共享实现，保留手动连接保存和默认配置失焦保存；不修改认证或持久化行为。
- 状态：completed

## 验证与交接

- RED：新增布局浏览器回归，原实现 12 项失败：无独立详情滚动区、骨架变体及尺寸不符。
- GREEN：desktop `pnpm exec vitest run --config vitest.browser.config.ts` 指定 acp-settings-layout / acp-settings-panel / acp-auth-settings / acp-default-settings 及真实 global-settings-page / settings-lazy-loading，Chromium/WebKit 共 94 项通过，包含原有保存与登录行为。
- 根 `pnpm exec vitest run packages/ui/src apps/web/src/features/settings/components`：132 项通过；SSR 可访问性断言改为不依赖属性顺序，保持标签、角色和状态检查。
- `pnpm exec playwright test tests/e2e/app-shell-acp-auth.spec.ts tests/e2e/app-shell-acp-enable.spec.ts tests/e2e/app-shell-settings-connection.spec.ts --workers=2`：22 项通过。最后仅将下拉框与输入框改为公共紧凑尺寸；功能证据复用，最后尺寸已由 94 项浏览器回归重验。
- 双端 build（含 typecheck）、lint、Web bundle、desktop performance:budget、定向格式检查通过；架构检查无违规；package:check 通过。Web 首屏 353.40 KiB / 360 KiB，工作台就绪 494.35 KiB / 520 KiB。
- 简化：changed，将设置内多份开关实现收束到共享 Switch；业务保存、禁用和错误重试策略不变。规范更新至 UI shared 索引。
- 内部查看最终实际截图确认选中背景统一、控件密度与固定标题；遵循用户既有偏好，不附截图、不提交 Git。
