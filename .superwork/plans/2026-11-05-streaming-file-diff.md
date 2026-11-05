# Feature Implementation Plan

**Goal:** 两端通过默认开启的设置切换独立流式文件差异卡片，保留原展示。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 跨端与性能规则。
- `.superwork/spec/frontend-core/shared/index.md` — 偏好、增量订阅与文件布局。
- `.superwork/spec/ui/shared/index.md` — 共享 UI 及按需加载。

**Architecture:** 共享偏好新增 independentFileDiffs，AI Elements Collapsible/Button 组合卡片按需加载原有 PatchDiffViewer；两端分组将文件项独立并保留终态，原模式默认不变。

**Tech Stack:** React、TypeScript、Radix、Vitest、pnpm。

## Global Constraints

- Web、移动浏览器与桌面共用核心逻辑和 UI，不增加传输与逐 Token 历史扫描。
- 关键逻辑使用中文注释，重型补丁高亮按需加载。
- 默认开启，旧存储缺失字段视为 true，显式 false 保留用户关闭选择；终态与失败状态必须真实呈现。

### Task 1: 实现独立文件差异展示与切换

**Files:**

- Modify: `packages/frontend-core/src/conversation-display-preferences.ts`
- Modify: `packages/frontend-core/src/conversation-display-preferences.test.ts`
- Modify: `packages/ui/src/agent/file-diff-card.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-file-diff.test.tsx`
- Modify: `desktop/tests/browser/streaming-file-diff.browser.test.tsx`
- Modify: `desktop/src/features/settings/components/conversation-display-preferences.browser.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-file-changes.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-operation-groups.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-operation-groups.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-assistant.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-process.ts`
- Modify: `apps/web/src/features/settings/components/general-settings-panel.tsx`
- Modify: `apps/web/src/i18n/locales/en/settings-general.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings-general.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `desktop/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-file-changes.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-operation-groups.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store-operation-groups.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store-assistant.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-process.ts`
- Modify: `desktop/src/features/settings/components/general-settings-panel.tsx`
- Modify: `desktop/src/i18n/locales/en/settings-general.ts`
- Modify: `desktop/src/i18n/locales/en/conversation.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/settings-general.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/conversation.ts`

**Interfaces:**

- Consumes: AgentItem file_change、TaskItemStore、ConversationDisplayPreferenceStore、normalizeFileChangePatch。
- Produces: independentFileDiffs 布尔偏好、FileDiffCard、可独立展示的文件条目。

**Behavior:**

- 开关关闭维持原分组和汇总；开启时文件卡片独立于命令工具，默认展开并可折叠，流式更新补丁，完成、失败、中断均保留对应状态。
- 显示文件路径、增删统计、差异和状态，支持宽窄容器与键盘。

**Stop Conditions:**

- 数据契约缺少实际补丁时仅提示暂无差异，不推测文件内容。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/frontend-core/src/conversation-display-preferences.test.ts apps/web/src/features/workbench/components/task-timeline-file-diff.test.tsx`

Expected: 偏好恢复、分组隔离及两种展示测试通过。

## 执行与验证证据

- 并行登记：`streaming-file-diff-20261105` / `codex-streaming-diff`；修改范围避开已有任务所有权。补充 Web / 桌面前端索引记录默认关闭、独立分组、状态保留和 320px 高度契约。
- RED：新增偏好恢复及文件组隔离测试，两项分别因字段缺失及文件仍在命令组中失败；GREEN 后补充终态保留覆盖。
- 简化结果 changed：将旧文件渲染提取为明确组件，避免 switch 内嵌套立即调用函数；按需加载新增卡片，避免增加工作区及编辑器静态依赖。最终 targeted 验证已覆盖该改动。
- 用户补充要求：差异正文最大 320px，超出内部滚动，标题和状态栏保持可见。真实 151 行新增补丁在 Chromium / WebKit、360px / 1280px 的两端入口均验证高度及滚动。
- `pnpm test`：3983 通过，13 跳过；`pnpm --dir desktop test:run`：697 通过。二者在最终卡片模块改为 lazy 之前运行；此后仅更改加载边界，最终分别以共享/时间线 578 项及桌面时间线 46 项通过验证变化范围。
- 最后代码修改后 `pnpm exec vitest run packages/frontend-core/src apps/web/src/features/workbench/components/task-timeline`：578 通过；`pnpm --dir desktop test:run src/features/workbench/components/task-timeline`：46 通过。
- 最后代码修改后 `pnpm --dir desktop test:browser tests/browser/streaming-file-diff.browser.test.tsx src/features/settings/components/conversation-display-preferences.browser.test.tsx`：10 通过，双浏览器、双端宽窄屏，覆盖实时切换、补丁更新、终态、折叠、打开原预览、大补丁高度及既有偏好兼容。冷启动异步高亮断言设置 10 秒等待，不绕过实际渲染。
- `pnpm test:performance`：16 通过；加载边界改动后两端生产构建、Web `bundle:check`、桌面 `performance:budget` 均通过，未放宽预算。
- 最后代码修改后根及桌面 lint、两端 typecheck、根 lint:architecture 均退出 0。格式及 diff 检查通过，桌面源文件不超过 500 行。
- 原生 Rust、操作系统安装包及真机未修改，不运行 Rust 和发布门槛；沿用两端既有事件传输，无协议或依赖变更。

- 最终 `pnpm --dir desktop build:legacy` 退出 0，保持 macOS Legacy 预览适配；最终格式、计划预检、diff 检查及桌面 500 行限制通过。

## 2026-11-05 卡片视觉优化

- 用户要求重新优化设计，并将正文最大高度减半。复核发现旧实现的 `rounded-panel`、`border-border` 等主题类未定义，导致圆角和分隔线退化；新增浏览器断言先复现圆角为 0 的 RED。
- 使用工作台真实表面、8px 圆角和低对比分隔线，标题突出文件名，目录弱化并截断，增删统计固定保留；状态与打开入口收紧到紧凑底栏。正文最大高度调整为 160px，整卡保持约 222px 内。
- 新样式通过卡片模块按需加载，避免进入默认工作区及编辑器静态 CSS；为共享组件添加 CSS 副作用导入类型声明。Pierre Shadow Host 继承工作台 color-scheme，避免应用暗色而补丁仍跟随系统浅色。
- 简化审查：no-change；沿用既有 Collapsible/Button 和按需补丁解析，不引入布局监听、额外状态或新依赖。

- 最终验证（本轮最后代码变更后）：两端 Chromium/WebKit、明暗主题、360/1280px 共 16 项浏览器测试通过，覆盖长路径文件名、实际圆角/边框、160px 正文上限、整卡高度、滚动、主题继承、折叠和打开原差异入口；实际截图已检查。
- 共享 UI 87 项测试通过；根/桌面 lint、两端 typecheck、lint:architecture、两端生产构建及包体预算、桌面 Legacy 构建、500 行限制、格式和 diff 检查均通过。CSS 副作用导入声明及主题继承变更由最终类型/构建和浏览器测试覆盖。
- 本轮仅变更共享卡片 UI/CSS 和布局测试，不重复运行上一轮全量引擎/服务端测试；无依赖、协议、事件或持久化变化。规范同步更新正文上限及工作台主题令牌要求。

## 2026-11-05 完成回合的差异收入过程

- 按用户新要求，运行时独立展示文件差异；回合完成后统一收入“已处理”执行过程，默认不挂载 diff，展开可恢复，收起后卸载。旧显示模式、160px 高度及卡片视觉保持原契约；同步调整两端中英文设置说明。
- RED：新增完成回合分类测试，因返回空过程 ID 集合而失败；GREEN：将独立模式文件项在最终答复位置判断之前分类，覆盖无最终答复和迟到文件项，不依赖内容扫描。两端复用既有过程展开、历史分页和条目渲染链路。
- 最终同一工作区验证：Web 时间线 141 项、桌面时间线 46 项通过；Chromium/WebKit 两端明暗主题、360px/1280px 及完成历史加载共 20 项浏览器验证通过，覆盖运行中卡片、完成自动折叠、展开/收起、原模式切换。类型、根/桌面 lint、架构检查通过。
- 简化审查 no-change：沿用既有过程分类函数，只增加文件项判断，不新增组件、状态、订阅或依赖。规范更新完成态折叠规则；不变更协议、引擎与原生代码。

- 最后实现变更后两端生产构建及各自包体预算均通过；格式、diff 检查、桌面 500 行限制通过。

## 2026-11-05 默认开启独立差异

- 按用户要求，将共享 `independentFileDiffs` 默认值改为 true；缺失、损坏与不可读存储均默认启用，保留显式 false。吸顶和目录继续默认关闭，运行完成后收进过程的规则保持。
- RED：新默认值及异常字段恢复测试因旧实现返回 false 而失败。GREEN：更新默认值和解析规则，两端共用同一个 Store 工厂；手动关闭会持久保存。
- 简化审查 no-change：仅调整布尔默认与恢复条件；没有新依赖、事件、监听或计算开销。不重复运行引擎/原生与发布检查，验证聚焦偏好持久化、开关渲染、时间线与两端类型检查。

- 本轮验证：偏好/时间线单元测试 17 项通过；两端 Chromium/WebKit 浏览器 24 项通过，包含新建开关默认开启、手动关闭后的重新读取和既有折叠行为。根与桌面类型检查、lint、格式及 diff 检查均通过。

## 2026-11-05 收紧未修改行分隔

- 用户要求收紧“unmodified lines”整行并移除上方间距。将行内卡片分隔高度由渲染器默认 32px 改为 20px，使用 caption 字号；通过渲染器纵向间距变量移除正文顶部留白，保留代码行高、横向滚动和 160px 正文上限。
- 卡片通过继承 CSS 变量注入紧凑参数，Shadow DOM 内只读取变量并保留原默认值，因此完整差异预览仍是 32px 分隔及原有上下文间距。不增加 JS 状态、监听或依赖；简化审查 no-change。
- RED：两端多段补丁的布局断言先以实际分隔高度 32px 失败。GREEN：Chromium/WebKit 双端、明暗主题、360/1280px、多段分隔、顶部位置、完成折叠与完整预览对照共 26 项通过；实际截图已检查。
- 最后实现修改后共享 UI 87 项测试、两端类型检查、根/桌面 lint、两端生产构建及包体预算、格式、diff 检查和桌面 500 行限制全部通过。仅修改共享样式及相关浏览器回归，不重复运行无关引擎/原生与发布门槛。
