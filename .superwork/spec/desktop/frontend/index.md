# 桌面前端

## 位置与职责

`desktop/src/app` 与 `features` 承载应用和功能，`platform/tauri` 负责原生传输，`protocol` 维护桌面适配契约，`shared` 与 `i18n` 负责端内组合和翻译。原生边界见 [Rust 后端](../backend/index.md)。

## 契约与检查项

- [ ] 回合耗时展示共用 UI 的 `useTurnProcessingTime`：页面隐藏立即停止秒级刷新，恢复按当前绝对时间校准；终态与卸载释放订阅，分屏共用单一定时器。回归入口为 `packages/ui/src/agent/turn-processing-clock.test.ts`。

- [ ] 使用 Tauri 原生链路；将 IPC、终端、窗口与系统集成留在平台适配层，共用组件和纯逻辑复用 UI / Frontend Core。
- [ ] 状态栏图标显示开关默认开启，原生配置即时生效并跨重启保留；隐藏仅控制图标，不改变关闭窗口后最小化到托盘的行为。回归入口为 `tray-settings-field.browser.test.tsx` 与 Rust `tray_settings` 测试。
- [ ] 关于页的检查更新按钮必须保持固定位置，版本状态、检查中文案和安装入口变化不能让连续点击落到安装按钮；布局回归需加载真实样式，并按原坐标再次点击。验证入口为 `global-settings-about.browser.test.tsx`，覆盖窄窗口及 Chromium / WebKit。
- [ ] 共享组件变更同时检查 Web 调用者；桌面私有能力与 macOS Legacy 分支遵循 [能力参考](../../../../desktop/docs/codexly-capability-matrix.md)。
- [ ] 流式消息保持有界增量更新，文档 / 分屏工作区核对焦点、滚动、键盘和拖拽行为。参照 [文档工作区](../../../../docs/document-workspace.md)。
- [ ] 快捷键帮助区分全局命令与功能内按键，并标注编辑器、输入框和项目标题等生效场景；新增条目同步中英文，长列表须支持窗口内滚动。回归入口为 `workbench-shortcuts.browser.test.tsx`，同时验证共享帮助菜单随文字长度自适应。
- [ ] 源文件与测试文件遵守桌面 500 行限制，由 `source:lines` 检查。
- [ ] 自动化使用 `pnpm --dir desktop test:run`；布局与焦点使用 `pnpm --dir desktop test:browser`，覆盖 Chromium / WebKit。
- [ ] 输入区域从可写切换为锁定时，在布局阶段释放边界内部的焦点；不要依赖浏览器对 `disabled` / `inert` 的自动失焦，也不能移走其他分栏的焦点。回归入口为 `composer-ownership.browser.test.tsx`。
- [ ] 底栏通过 Portal 移出聊天裁剪区时，输入框使用专用双层阴影，保持既有 12px 留白和 36px 底栏；不要用过淡的控件阴影代替，也不要增加间距来避开裁剪。`composer-ownership.browser.test.tsx` 覆盖 Chromium / WebKit、明暗主题及单窗 / 分屏；测量普通阴影前须移除展开操作产生的编辑器焦点。
- [ ] 非聊天标签独占中栏时隐藏分支、项目路径及上下文底栏；外置 Portal 通过共享 `DocumentChatVisibilityContext` 跟随聊天可见性，不能仅依赖 Activity 的 DOM 隐藏。返回聊天或并排对照时恢复底栏并保留输入草稿；回归入口为 `document-workspace.browser.test.tsx`，覆盖 Chromium / WebKit。
- [ ] 原生 WebView 测试及模拟运行时从根工作区已安装的 `@openai/codex/package.json` 读取版本，与运行时打包脚本共用来源，避免升级后留下独立硬编码预期。
- [ ] `pnpm --dir desktop check:web` 覆盖静态检查、类型、测试、Tauri 约束、现代 / Legacy 构建和包体预算；完整桌面门槛是 `pnpm --dir desktop check`。

开发入口见 [桌面开发](../../../../desktop/docs/development.md)。

## 正文来源引用

- 复用 `@codexly/ui/agent/inline-citation`，来源卡片中的 HTTP(S) 链接继续经 `openMarkdownLink` 打开系统浏览器，不能让 WebView 导航离开应用。保留文件定位、图片与指令入口，不增加来源抓取请求。
- Radix HoverCard 默认将卡片链接移出 Tab 顺序，共享组件必须衔接触发按钮与来源链接的键盘焦点；Escape 关闭并返回触发按钮，延迟打开不能令浮层重新出现。`inline-citation.browser.test.tsx` 覆盖 Chromium / WebKit、窄屏与流式追加后的节点、焦点及浮层状态。
- 正常键盘聚焦须保留 Radix 的打开处理，以取消旧悬停关闭计时器；仅 Escape 恢复焦点时阻止重新打开。测试须等来源链接挂载后切换焦点，并跨过关闭延迟验证卡片仍可阅读及 Escape 后保持关闭；不能只检查瞬时展开属性。

## 子代理详情

- 与 Web 共用 Subagent 展示和 Tool 详情滚动容器。顶部任务与嵌套回合初始用户消息相同时仅展示一次；有省略标记也需去重，后续追问和附件保留。桌面思考条目只使用公开 `summary`，不展示原始推理 `content`。
- 弹窗最大高度 `min(80dvh, 48rem)`，标题固定、正文独立滚动。子代理详情默认跟随输出到底部；上滚、触控或选择记录时暂停，手动回到底部后恢复。不能通过滚动祖先实现跟随，也不把滚动位置写入 React 状态。
- `src/shared/components/agent/subagent.browser.test.tsx` 覆盖 Chromium / WebKit、宽窄屏、高度、输出增长、上滚暂停/恢复、卸载及焦点；同时运行 `task-timeline-operation-groups.browser.test.tsx` 检查普通工具/终端详情兼容性。
- 右栏内嵌/独立子代理均复用同一弹窗和结构化执行窗口；独立子线程通过原生运行时和单条 Item Store 更新，保留历史入口，不使用另一套完整聊天时间线。初始任务只显示一次，只有用户任务的摘要仍可加载更早过程。
- `src/features/workbench/components/subagent-output-dialog.browser.test.tsx` 以真实桌面 Store 验证两种来源增量输出、跟随/暂停/恢复及关闭焦点；右栏打开按钮先显式聚焦，保证 WebKit 关闭后返回正确入口。

## 聊天快捷打开

- 聊天与项目共用标题栏快捷打开菜单，窄窗口保留入口，工具视图隐藏。已有聊天沿用 `createProjectOpenRequest` 传递任务身份，由原生接口解析 cwd；新聊天尚未分配任务目录时显示禁用入口。
- 回归入口：`workbench-shell-header.test.ts`、`workbench-panel-layout.test.ts` 和 `tests/browser/chat-quick-open.browser.test.tsx`（双浏览器、宽窄窗口、默认应用与菜单选择）。

## Mermaid 图表

- 两端消息正文统一注册 `@codexly/ui/agent/deferred-mermaid`，只在渲染图表时加载引擎，共用在途加载并允许加载失败后重试；不得退回普通代码块。
- 回归覆盖静态正文、流式快照、未闭合围栏及回合结束，使用截图中的中文标签和分支流程图验证实际 SVG。入口为 `desktop/src/shared/components/agent/message-response-mermaid.test.ts` 与 `desktop/tests/browser/mermaid.browser.test.tsx`（Chromium / WebKit，包含 Web 调用者）。
- Mermaid 的 `@mermaid-js/parser` 含不可继续按模块拆分的单个核心模块，现代 / Legacy 构建约 662 KB；桌面异步块上限为 675,000 字节。首屏、工作台、Markdown、高亮及编辑器场景预算保持原值，图表引擎不得进入静态依赖闭包。
