# 文件编辑体验设计

## Goal

让 Markdown、TXT、代码文件在 Web、移动浏览器、桌面具备清晰、可恢复的编辑和文件管理体验。

## Suggested Spec Reads

- `.superwork/spec/guides/code-reuse-thinking-guide.md`
- `.superwork/spec/guides/cross-platform-thinking-guide.md`
- `.superwork/spec/ui/shared/index.md`
- `.superwork/spec/frontend-core/shared/index.md`
- `.superwork/spec/web/frontend/index.md`
- `.superwork/spec/desktop/frontend/index.md`
- `docs/text-file-editing.md`

## 现状与选择

已有 CodeMirror 6、2 MiB 有界 UTF-8 会话、乐观并发保存、失焦保存、导航保护、新建/重命名/删除 API。缺少可发现的编辑命令、状态和冲突比较；变更弹窗重复且失败反馈不足。
采用 CodeMirror 官方 search、merge、语言扩展组合；不采用不支持移动浏览器的 Monaco，也不自研文本内核。

依据：

- https://code.visualstudio.com/docs/editing/codebasics.md （保存、查找替换、缩进、比较）
- https://code.visualstudio.com/docs/getstarted/userinterface （状态与工作区）
- https://codemirror.net/docs/guide/ （模块化、viewport、生命周期）
- https://codemirror.net/docs/ref/ （search、unifiedMergeView、diffConfig）
- https://github.com/microsoft/monaco-editor#faq （移动端限制）

## 推荐实现与职责

共享 UI 提供紧凑编辑命令行、底部保存/光标/编码/换行状态；官方查找替换支持大小写、整词、正则；撤销重做、自动换行、折叠和缩进使用官方扩展。普通输入不复制全文到 React，状态栏局部订阅。
冲突比较只在显式打开时读取磁盘，按需加载统一差异视图；当前草稿保持独立且只读比较，用户可返回编辑、确认载入磁盘、确认用已比较草稿替换磁盘。替换仍提交磁盘快照的 expectedVersion；后台再次修改应拒绝。错误常驻，草稿保留。读取错误和卸载取消不能丢草稿。
两端文件变更对话框改用同一实现，复用可移植名称校验，主名预选、内联错误、重复提交锁和安全取消聚焦。平台继续负责传输与缓存。

## 视觉

沿用现有 content/raised/foreground/muted/brand 主题变量及无衬线 UI、等宽正文，不引入字体请求。工具行控制密度、底栏聚合文件状态；冲突使用有标题的可滚动差异区与明确动作。窄屏允许换行和紧凑图标，保持焦点可见。

## 错误与性能

保留 2 MiB、256 KiB 解析阈值、会话预算和条件保存。差异计算设置 scanLimit 与 timeout；没有后台轮询、LSP、全文逐键同步或重型首屏依赖。保存中禁止恢复，过期比较不允许覆盖新草稿。

## 非目标

Office/富文本、LSP、项目级自动格式化、编码转换、跨重启草稿恢复和操作系统回收站协议。

## 验证与成功标准

状态机覆盖载入磁盘、条件覆盖、二次冲突、保存期间修改。真实 Chromium/WebKit 测试查找替换、撤销、状态、冲突、主名预选和错误重试；Web/桌面类型与构建预算、既有文本性能和文件操作回归。实测记录不冒充真机结果。
