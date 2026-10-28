# AI Elements 全量迁移设计

## Goal

Web、移动浏览器及桌面统一采用 2026-10-28 shadcn/ui AI Elements 组合方式，删除旧会话虚拟化和重复组件实现，保留现有主题与业务能力。

## Suggested Spec Reads

- `.superwork/spec/guides/code-reuse-thinking-guide.md`
- `.superwork/spec/guides/cross-platform-thinking-guide.md`
- `.superwork/spec/ui/shared/index.md`
- `.superwork/spec/web/frontend/index.md`
- `.superwork/spec/desktop/frontend/index.md`

## 现状与取舍

现有两端会话独立虚拟化、原生 details 工具卡片与重复输入组件；共享 UI 已承载增量 Markdown、高亮和主题基础组件。只换视觉不能满足底层迁移；完整替换业务聊天 SDK 会破坏已有双引擎协议。选择官方迁移指南推荐的保留业务接口、替换所有渲染基础组件路径。

## 推荐方案与接口

- 从官方 radix-nova registry 复制 Message/Bubble、Trace、Code Block、Attachment、Input Group、Item；将主题映射到现有 token，不引入新主题。
- Message Scroller 使用官方 `@shadcn/react/message-scroller`。共享 ConversationList 采用真实 DOM、content-visibility，自动跟随和 prepend 锚定由 primitive 管理。会话身份和主动发送信号由平台传入，导航按稳定消息锚点定位。
- Tool、Task、Plan、Queue、Terminal 组合 Trace；Message 组合 Message/Bubble；审批组合 Item/Button；输入框组合 InputGroup/Attachment；上下文使用 HoverCard/Progress；文件树使用 Collapsible/Button。相同组合只保留共享实现，翻译与平台 I/O 留在端内薄适配器。
- 代码块的新基础组件上保留分批高亮、有界缓存和完整复制；Streamdown 与增量 Markdown 属于官方保留路径，继续复用。

## 错误处理

保留审批与发送互斥、失败重试、文件打开回调、输出错误、复制失败处理；无新增网络协议或自动提交。滚动导航失败不得误发消息或恢复跟随。

## 验证策略

先记录旧实现不满足完整 DOM / 新基础层的失败证据。运行两端单元、类型、架构、构建与预算检查；浏览器覆盖滚动跟随、手动回看、历史 prepend、导航、输入与工具折叠，检查移动宽度和主题。

## 非目标

不修改引擎协议、后端、历史分页大小、发布版本；不移除文件树及超长代码专用虚拟化。

## 成功标准

所有现有 Agent 组件使用新版基础层；两端共用；无旧会话虚拟列表与双版本开关；分页、搜索导航、流式及输入语义通过回归。主题仍使用现有颜色、密度、字体和圆角。
