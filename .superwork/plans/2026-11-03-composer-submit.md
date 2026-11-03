# Feature Implementation Plan

**Goal:** 两端采用分体发送按钮，从下拉保存待办或以当前正文新建提示词。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局约束。
- `.superwork/spec/ui/shared/index.md` — 共享组件及弹窗。
- `.superwork/spec/web/frontend/index.md` — Web 与移动端。
- `.superwork/spec/desktop/frontend/index.md` — 桌面入口。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 复用边界。

**Architecture:** 共享分体按钮与提示词编辑弹窗；平台注入现有提交状态及待办保存回调。

**Tech Stack:** React、TypeScript、pnpm、Playwright、Vitest。

## Global Constraints

- 关键逻辑使用清晰中文注释；不引入轮询、额外传输或逐帧状态。
- 兼顾 Web、移动与桌面；保持已有发送、排队、停止和捕获提交语义。
- 公告身份：composer-submit-20261103 / codex-composer-submit。

### Task 1: 实现并验证发送下拉与正文预填

**Files:**

- Create: `packages/ui/src/core/composer-submit-actions.tsx`
- Create: `packages/ui/src/core/saved-prompt-editor.tsx`
- Modify: `packages/ui/src/core/saved-prompts-settings.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-composer-view.tsx`
- Test: `tests/e2e/app-shell-composer-save.spec.ts`

**Interfaces:**

- Consumes: WorkbenchComposerViewProps、saveSharedPrompt、SavedPromptDraft。
- Produces: ComposerSubmitActions、SavedPromptEditor。

**Behavior:**

- 左侧固定发送动作，右侧菜单保存待办或创建提示词；正文原样预填且不自动发送。
- 提示词编辑复用设置页校验、提交锁及脏草稿保护。

**Stop Conditions:**

- 状态机契约不明确或范围与其他公告冲突时暂停对应部分。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-composer-save.spec.ts`

Expected: 宽窄屏和三浏览器均通过，正文预填、保存及发送动作符合预期。

## 验收记录

- RED：新增发送入口回归在 Chromium 宽窄屏失败，当前入口尚无“发送”文字与下拉菜单。
- GREEN：`pnpm exec playwright test tests/e2e/app-shell-composer-save.spec.ts tests/e2e/app-shell-saved-prompts.spec.ts tests/e2e/app-shell-composer-overflow.spec.ts --workers 2`，27 项通过，覆盖三浏览器、正文保真、保存待办、直接发送、无意外提交和窄屏布局。
- `pnpm --dir desktop test:browser src/features/settings/components/saved-prompts.browser.test.tsx src/features/workbench/components/composer-ownership.browser.test.tsx src/features/workbench/components/project-draft-controls.browser.test.tsx`：最终修改后 Chromium / WebKit 54 项通过。
- `pnpm --dir desktop test:run`：163 文件、686 项通过。平台标签的最后调整不改变单元测试输入或领域逻辑，复用该结果。
- `pnpm test`：673 文件通过，3961 项通过、13 跳过、1 项 Claude SDK 集成测试首轮失败；`pnpm exec vitest run packages/provider-claude/src/sdk-integration.test.ts` 独立复跑，9 项全部通过。未修改 SDK 实现。
- 共享 UI / 待办定向 Vitest：15 文件、91 项通过。
- `pnpm build`、`pnpm --dir desktop build`：最终代码均构建通过，含两端类型检查。
- `pnpm bundle:check` 与 `pnpm --dir desktop performance:budget`：通过，未提高预算。
- `pnpm lint:architecture`、改动文件 Oxlint、Prettier、`git diff --check`：通过；桌面源文件 459 行，满足 500 行限制。
- 简化结果 changed：将提示词编辑器从设置页提取为按需加载的共享模块，发送按钮复用单一状态推导，相关浏览器测试已重新通过。
- 规范 update：在 `.superwork/spec/guides/code-reuse-thinking-guide.md` 记录表单 Portal 冒泡边界与回归入口；该文档已由 guides、Web 和桌面索引引用，格式检查通过。
- 范围说明：本次界面改动采用相关浏览器套件验证，未运行完整 E2E / 桌面浏览器全集或 Rust 平台真机测试；没有原生及传输协议改动。
- 共享影响：两端入口使用 `ComposerSubmitActions`，设置与发送菜单使用 `SavedPromptEditor`；平台沿用既有提交、排队、停止和待办回调。

## 第二轮视觉微调

- 按用户反馈收紧按钮：32px 降为 28px，发送文字使用 12px 中等字重，发送区水平内边距 8px；下拉热区宽 20px、箭头 12px。淡描边、短分隔线和内缩悬停背景沿用现有主题令牌。
- 同时修改 Web、桌面调用者与共享组件，未更改发送状态机或菜单动作。
- RED / GREEN：尺寸与两端样式定向断言先失败后通过；此轮为可逆样式调整，不新增实现镜像测试。
- 最终验证：`pnpm build`、桌面类型检查、改动文件 Oxlint、Prettier、`git diff --check` 均通过。
- 浏览器：发送下拉与窄栏布局三浏览器 21 项通过；桌面输入区 Chromium / WebKit 36 项通过。额外宽窄屏截图验收 2 项通过，已检查 390px 的真实渲染结果，无溢出。
- Web 包体预算通过：首屏 351.81 KiB，工作台 513.52 KiB。
- 本地 3210 常驻服务缓存旧 HTML，入口脚本返回 404；未干预该服务，视觉验收使用仓库生产构建与独立测试夹具。
- 简化 no-change：仅调整现有样式。规范 no-update：没有新增持久契约，继续沿用上一轮的共享边界。复用此前已读取规范，本轮仅验证受影响界面与类型，不重复无关服务端和原生测试。
- 公告身份 composer-polish-20261103 / codex-composer-polish，验收后释放。

## 第三轮居中与平面悬停优化

- 保留当前分体布局，去除容器内部 padding 与 gap；发送和下拉占满内部高度，共用唯一外层圆角与背景。
- 将两端发送文字样式统一到共享 `composerSubmitButtonClassName`，改为主题常规字重；显式 flex 居中、16px 行高并禁用文字状态切换缩放，避免文字位置跳动。
- 内部按钮悬停背景透明、无可见阴影；只保留整体轻微底色变化和键盘焦点提示。
- 临时浏览器渲染验收 RED：实际字重 550，不是常规字重。GREEN：三浏览器 × 两种宽度 6 项通过；核对常规字重、透明内部悬停背景、无可见投影，以及文字与发送区域中心偏差不超过 0.5px。Tailwind 的 shadow-none 输出透明零尺寸层，验收按可见阴影判定。
- 已人工检查 390px 悬停截图，保留平整外框，内部没有重复胶囊。
- 最终 `pnpm build`、桌面类型检查、改动文件 Oxlint / Prettier、`git diff --check` 均通过；Web 包体预算通过。
- Web 发送下拉与布局回归三浏览器 21 项通过；桌面输入区双浏览器 36 项通过。
- 简化 changed：两端复用唯一发送文字样式定义，避免继续复制视觉参数。规范 no-update：纯视觉优化，未改变交互或持久契约；不重复无关服务端和 Rust 测试。
- 公告身份 composer-flat-20261103 / codex-composer-flat，验收后释放。

## 第四轮提示词默认范围

- 用户要求：项目会话保存常用提示词时默认当前项目，普通聊天默认全局。
- 两端 View 显式接收 projectId，并按既有 projectToolsEnabled 区分项目与普通聊天；共享发送菜单把正文与项目身份在点击时一起固定，传给同一提示词编辑器。弹窗允许手动改为全局，不新增项目列表请求。
- RED：项目入口范围实际显示“全局”，新增默认范围断言失败。GREEN：最终 `pnpm exec playwright test tests/e2e/app-shell-composer-save.spec.ts --workers 2`，18 项全部通过；覆盖三浏览器、宽窄屏、项目与聊天，并核对保存请求中项目 ID 的存在或缺省。
- 范围显示复用宿主提供的项目名称；项目目录尚未加载时沿用已有项目 ID 回退，测试同时核对真实保存 ID，不依赖项目名称加载时序。
- 桌面设置提示词和输入区浏览器回归 46 项通过；最终桌面类型检查通过。修改回调为直接传递 setMutationError，与先前包装等价，类型检查重新通过；两端 Base 保持 499 行。
- 最终 `pnpm build`、改动文件 Oxlint、Web 与共享文件 Prettier、`pnpm lint:architecture`、`git diff --check` 通过。Web 包体预算通过，工作台就绪 513.66 KiB。
- 最终检查 simplification changed：去掉两端多余的错误回调包装；spec update：在 code-reuse-thinking-guide.md 中记录默认范围、点击时范围快照以及保存数据验证要求。
- 未改传输接口、服务端存储或 Rust 原生实现，未重复无关全量测试。
- 公告身份 prompt-scope-20261103 / codex-prompt-scope，验收后释放。

## 第五轮发送区视觉比例

- 发送区水平留白从左右各 10px 改为左 14px、右 10px，宽度增加 4px，文字相对区域中心向右 2px；下拉区从 24px 缩为 20px，箭头从 12px 缩为 10px，整体宽度基本不变。
- 仅修改共享样式，两端同步；保持常规字重、平面悬停与现有功能。
- 尺寸定向断言 RED / GREEN 均已观察。三浏览器宽窄屏视觉验证 6 项通过，实际测量文字右移 2px、下拉宽 20px、箭头宽 10px，并检查窄屏截图。
- Web 发送与保存回归三浏览器 18 项通过；桌面输入区浏览器 36 项通过。
- `pnpm build`（含类型检查）、共享文件 Oxlint / Prettier、`git diff --check`、Web 包体预算通过。
- 简化 no-change；规范 no-update：仅视觉参数微调，无新契约，不重复无关服务端与原生测试。
- 公告身份 submit-balance-20261103 / codex-submit-balance，验收后释放。

## 第六轮项目名称显示修复

- 原因：Web 已有任务链路 ShellLayout → ActiveTaskWorkbench → WorkbenchComposer 漏传 projectName，输入框固定回退到 projectId。桌面对应链路原本正确。
- 更正第四轮记录：将 /codexly/i 视为名称验证不足，名称与 ID 仅大小写不同掩盖了漏传问题。此次改用“示例工作项目”和 ID codexly，严格断言名称，覆盖新建和已有会话。
- 修复：为 ActiveTaskWorkbench 增加必填项目名称并贯穿传递；共享弹窗只固定项目身份，同一 ID 的名称更新可刷新显示，跨项目切换仍保留原范围及用户输入。
- RED：已有项目会话实际显示 codexly，与“示例工作项目”不符；桌面共享组件的延迟名称回归也先失败。
- GREEN：最终三浏览器宽窄屏 E2E 24 项通过，核对显示名称、项目存储 ID、全局范围、正文保留及菜单行为。
- `pnpm --dir desktop test:browser tests/browser/composer-prompt-project.browser.test.tsx src/features/settings/components/saved-prompts.browser.test.tsx`：14 项通过，覆盖名称延迟更新、切换会话不改绑、保留用户修改、保存和设置管理。
- 最终 `pnpm build`、桌面类型检查、改动文件 Oxlint / Prettier、`pnpm lint:architecture`、`git diff --check`、Web 包体预算均通过。工作台就绪 513.72 KiB。
- 简化 no-change：保持单一共享弹窗，不新增请求或效果监听。规范 update：在代码复用指南记录必传显示名称、身份与名称分离、严格名称回归要求。
- 未改 Rust、协议或存储实现，不重复无关原生和服务端全量测试。已移除本轮测试自动生成的失败截图。
- 公告身份 prompt-name-20261103 / codex-prompt-name，验收后释放。

## 第七轮提示词范围完整项目列表

- 用户要求范围包含全局及所有项目，可任意重选；保留项目默认当前项目、普通聊天默认全局。
- 两端 ShellLayout 通过共享 ComposerPromptProjectsContext 注入已有完整项目目录，发送菜单的共享编辑器直接读取，避免沿多层输入框重复传参或额外请求。当前项目身份仍固定在点击时，显示名称优先从完整目录更新。
- RED：已有项目窄屏回归无法找到 superwork 选项。GREEN：三浏览器最终 E2E 24 项通过，宽屏验证默认范围保存，窄屏验证项目新建、已有任务和普通聊天都能改选其他项目，保持正文并保存到新项目 ID。
- 桌面共享菜单及提示词管理浏览器回归 18 项通过，新增项目 / 聊天两种来源的完整列表与跨项目保存用例；此前的名称延迟与会话切换回归保持通过。
- `pnpm build`、桌面类型检查、两端改动文件 Oxlint、桌面 source:lines、Prettier、架构检查、`git diff --check`、Web 包体预算均通过。
- 简化 no-change：复用现有目录和编辑器，不新增网络接口或轮询。规范 update：代码复用指南记录完整目录、默认选择与保存重选值的契约。
- 仅修改前端共享数据传递，未重复无关服务端或原生全量测试。
- 公告身份 prompt-all-projects-20261103 / codex-prompt-all-projects，验收后释放。

## 第八轮明确的悬停反馈

- 发送区 hover 使用主题浅色高亮底色与品牌文字色；下拉区独立使用中性色高亮，菜单打开时保留选中底色。移除外层过弱的统一 hover 变化。
- 延续平整分区与外层圆角，不加入投影、缩放、加粗或内部胶囊；常规字重和文字视觉偏移保持。
- RED：定向断言确认发送区仍为透明 hover 背景。GREEN：三浏览器 × 宽窄屏 × 明暗主题共 12 项视觉检查通过，真实背景在 hover 时改变、无可见投影、字重和文字位置保持；已核对窄屏悬停截图。
- 发送与待办 E2E 三浏览器 6 项通过，桌面输入区浏览器 36 项通过；`pnpm build`、共享文件 Oxlint / Prettier、`git diff --check`、Web 包体预算通过。
- 简化 no-change；规范 no-update：仅共享按钮的视觉状态变更，没有新交互或数据契约，不重复无关服务端或原生测试。
- 公告身份 submit-hover-20261103 / codex-submit-hover，验收后释放。

## 第九轮仅文字悬停反馈

- 按用户反馈取消所有按钮分区的悬停底色与菜单打开底色，发送文字从常规深灰加深到前景色；下拉箭头也仅改变文字颜色。不加粗、不投影、不改变比例。
- 定向断言先确认旧代码仍改变底色，修改后通过；三浏览器 × 宽窄屏 × 明暗主题 12 项视觉检查通过，实测 hover 前后底色相同、文字颜色变化、字重与位置保持，已核对窄屏截图。
- `pnpm build`、共享文件 Oxlint / Prettier、`git diff --check`、Web 包体预算通过；桌面输入区浏览器回归 36 项通过。
- 简化 no-change；规范 no-update：纯视觉状态调整，交互与保存逻辑不变，不重复无关行为及原生测试。
- 公告身份 submit-text-hover-20261103 / codex-submit-text-hover，验收后释放。
