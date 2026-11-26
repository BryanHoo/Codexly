# 跨 Agent 接续任务

## 目标

在历史聊天里选另一 Agent 后，发送时确认创建接续任务。确认后在新任务首轮发送原提示词和可查看的历史附件。原任务保留自己的聊天和执行身份。

## 建议阅读

- `.superwork/spec/guides/cross-layer-thinking-guide.md`
- `.superwork/spec/guides/code-reuse-thinking-guide.md`
- `docs/agent-engines.md`

同一任务多会话需要改变现有历史重放边界。创建独立任务可以沿用各 Agent 的原生恢复，并让用户确认分享的内容。选择独立任务，项目任务以来源任务的实际工作目录执行。临时任务沿用独立工作区分配，确认文案说明文件范围。

两端共用选择与确认状态。确认在草稿清空、上传与任务创建前完成，默认聚焦取消。提交复用既有创建及首发记录。共享 ACP 适配器校验来源归属和状态，按有界历史生成 `接续记录.md`。记录原始目标、近期对话以及关键执行结果，并标注省略范围。复用文本附件保存与 ACP 文本块传输，省去独立摘要请求。每次接续保留用户当前输入和附件的预算。

## 验收

取消时草稿和来源任务可继续使用。确认后新任务收到原输入和接续附件。两端刷新后附件可读。校验不合法的来源任务、活动回合、长历史以及重复提交。原生会话迁移、背景自动切换和历史二进制附件复制不在本项范围内。

[ACP 内容规范](https://agentclientprotocol.com/protocol/v1/content) · [W3C 警告对话框](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/) · [幂等提交参考](https://docs.stripe.com/api/idempotent_requests)
