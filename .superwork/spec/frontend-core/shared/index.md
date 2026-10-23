# 前端共享逻辑

## 位置与职责

`packages/frontend-core/src` 承载 Web / 桌面共用的视图模型、状态推导、增量 Markdown 和事件处理；`document-workspace.ts`、`split-workspace.ts`、`event-flush-scheduler.ts` 是现有复用入口。导出由本包 `package.json` 的根入口和子路径规则定义。

## 契约与检查项

- [ ] 不导入具体 Web / 桌面应用、Client、Core、Provider、Server 或根 CLI，传输与原生副作用由平台适配器承接。
- [ ] 文档、分屏、草稿与任务选择保持两端一致；修改共享规则时检查全部消费者。
- [ ] 沿用增量文本、字节 LRU 与批量事件调度，避免逐 token 重扫历史或无界缓存。
- [ ] 执行 `pnpm exec vitest run packages/frontend-core/src`、`pnpm typecheck`、`pnpm lint:architecture`；渲染状态变化补充两端交互验证与 `pnpm test:performance`。

相关契约：[文档工作区](../../../../docs/document-workspace.md)、[会话加载与性能](../../../../docs/conversation-performance.md)、[复用边界](../../guides/code-reuse-thinking-guide.md)。

## 常用提示词契约

- 标题（`name`）是唯一搜索依据；`/` 保留命令与 Skills，`#` 仅列出当前项目可用的自定义提示词。两端复用 [触发解析](../../../../packages/frontend-core/src/prompt-trigger.ts) 与 [提示词存储](../../../../packages/frontend-core/src/saved-prompts.ts)，标题支持内部空格。
- 同范围标题去除首尾空白后按大小写不敏感规则去重；项目同名标题覆盖全局标题，其他项目不可见。旧存储的 `shortcut` 不再参与匹配，旧版同名记录按 ID 全部保留，允许在原范围内编辑正文；写入仅保留当前字段。
- 选择仅替换光标前的触发片段，保留前后文本、文件和 Skill 引用及编辑器焦点，不自动提交。读取与索引复用快照，候选上限仍为 12。
- 验证入口：`pnpm exec vitest run packages/frontend-core/src/saved-prompts.test.ts packages/frontend-core/src/prompt-trigger.test.ts`；Web 回归为 `tests/e2e/app-shell-saved-prompts.spec.ts`，桌面回归为 `composer-ownership.browser.test.tsx` 与 `saved-prompts.browser.test.tsx`。

## 异步问答提醒

- 两端仅将完整助手问题消息投影为待回答通知和任务活动；普通消息及 Token 增量直接跳过。每组新问题独立提醒，事件重放须去重。
- 待回答与待审批分开显示，任务可以继续执行；聚焦任务仅确认通知已读，不解除尚未处理的问题。成功回答或显式关闭只解除对应问题，其他问题和审批保持等待。
- 复用既有全局活动订阅和有界通知去重，不新增轮询或逐 Token 历史扫描。验证覆盖共享通知存储、两端任务状态、Web 问答 API 与桌面原生活动/系统通知。
