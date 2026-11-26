# Feature Implementation Plan

**Goal:** 统一双端 ACP 模型选择，支持收藏、Agent 标签、思考左置和历史 Agent 锁定。

**Suggested Spec Reads:**

- `.superwork/spec/ui/shared/index.md` — 共享 ACP 控件。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 双端复用。
- `.superwork/spec/web/frontend/index.md` — Web 接入。
- `.superwork/spec/desktop/frontend/index.md` — 桌面接入。

**Architecture:** 共享 AI Elements ModelSelector（Command + Popover）接收原始 ACP 选项；草稿按需预览其他 Agent，历史只消费所属 Agent 配置。通过共享 Context 打开宿主 ACP 设置。

**Tech Stack:** React、TypeScript、cmdk、Radix、pnpm、Vitest browser。

## Global Constraints

- 两端共用 UI，不引入后台轮询或并行启动所有 Agent。
- 不硬编码模型与思考枚举，不改变 ACP 原始标识和值。
- 使用全局主题与清晰中文注释，历史任务引擎不可改变。

### Task 1: 实现共享选择器与双端接入

**Files:**

- Modify: `.superwork/spec/ui/shared/index.md`

- Modify: `desktop/tests/browser/acp-workbench-composer.browser.test.tsx`

- Modify: `desktop/tests/browser/acp-native-composer.browser.test.tsx`

- Modify: `desktop/vitest.browser.config.ts`

- Modify: `desktop/src/features/workbench/components/project-sidebar-actions.tsx`

- Modify: `apps/web/src/features/workbench/components/project-sidebar-actions.tsx`

- Create: `packages/ui/src/core/acp-composer-settings.tsx`

- Create: `packages/ui/src/core/acp-model-selector.tsx`
- Create: `packages/ui/src/core/model-selector.tsx`
- Modify: `packages/ui/src/core/acp-draft-composer.tsx`
- Modify: `packages/ui/src/core/composer-toolbar.tsx`
- Modify: `packages/ui/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/web/src/features/workbench/components/workbench-acp-composer.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-acp-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-acp-draft-composer.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-acp-draft-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-toolbar.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-composer-toolbar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-layout.tsx`
- Test: `desktop/tests/browser/acp-model-selector.browser.test.tsx`

**Interfaces:**

- Consumes: `AcpConfigOption`、`AcpDraftClient`、`useAcpSession`。
- Produces: `AcpModelSelector`、共享思考与其他配置入口、ACP 设置导航上下文。

**Behavior:**

- 搜索、收藏、Agent 标签与模型勾选可键盘操作；历史只可切模型。
- 思考在左，模型显示 Agent / 模型，底部打开 ACP 设置。
- 其他 Agent 仅打开标签时预览；请求取消且迟到结果不污染当前选择。

**Stop Conditions:**

- ACP 原始配置无法区分模型时显示空态，保留其他配置入口，不猜测模型。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser tests/browser/acp-model-selector.browser.test.tsx`

Expected: Chromium / WebKit 交互测试通过。

## 执行与验证记录

- 共享影响：模型选择、思考左置、收藏和设置导航已在双端接入；会话配置与原始身份链路不变。
- 新增 `acp-composer-settings.tsx` 轻量上下文；两端 `project-sidebar-actions.tsx` 的设置 section 加入 ACP；浏览器预打包加入 cmdk。
- RED：原有草稿无法找到“Codex / 6.1 Sol”模型按钮；目标浏览器用例在两引擎下均失败。
- GREEN：根目录执行 `pnpm --dir desktop test:browser tests/browser/acp-model-selector.browser.test.tsx tests/browser/acp-draft-composer.browser.test.tsx tests/browser/acp-workbench-composer.browser.test.tsx tests/browser/acp-native-composer.browser.test.tsx`，28 项通过；随后修正测试主题设置为项目真实的 data-theme 并重新验证。
- 根 `pnpm test`：4444 通过，17 项已有可选跳过；桌面 `pnpm --dir desktop test:run`：835 通过；`pnpm test:performance`：16 通过。
- 根/桌面类型检查及构建通过；Web 包体 353.42 KiB 首屏、494.42 KiB 工作台，均在预算内；桌面包体预算通过。
- 简化审查：changed，将设置导航上下文提取到轻量文件，并保持壳层现有正文结构，避免 cmdk 进入首屏。后续类型、构建与包体检查覆盖该变更。
- 规范决策：update，共享 UI 索引记录模型/Agent 锁定、请求取消和收藏契约；不采纳分类脚本为配置文件创建额外 shared 层索引的建议。
- 验证环境为本机 macOS；本次无 Rust/原生协议修改，未运行跨系统原生安装与真实账号联网验证。

- 补充边界回归：跨 Agent 协商中切换项目，旧选择不能阻塞新项目；用旧 isBusy 推导运行测试得到两个预期失败，再加入 scope / engine 校验后通过。
- Web 端到端：`pnpm exec playwright test tests/e2e/app-shell-acp-enable.spec.ts tests/e2e/app-shell-acp-auth.spec.ts --workers=2`，Chromium / Firefox / WebKit 共 12 项通过。

## 最终证据

所有命令均在本工作树根目录执行，依赖保持 pnpm 锁文件状态；最后一次源码修改后：

- `pnpm --dir desktop test:browser tests/browser/acp-model-selector.browser.test.tsx tests/browser/acp-draft-composer.browser.test.tsx tests/browser/acp-workbench-composer.browser.test.tsx tests/browser/acp-native-composer.browser.test.tsx`：8 个浏览器文件、28 项通过（Chromium / WebKit）。
- `pnpm exec vitest run apps/web/src/features/workbench/components packages/ui/src/core/acp-config-options.test.tsx packages/frontend-core/src/acp-draft-binding.test.ts packages/frontend-core/src/acp-session-binding.test.ts`：85 文件、495 项通过，补齐此前全量根测试之后受影响源码的最新证据。
- `pnpm --dir desktop test:run`：183 文件、835 项通过。
- `pnpm build`、`pnpm --dir desktop build`：均退出 0，并覆盖两端 TypeScript 类型检查。
- `pnpm lint`、`pnpm lint:architecture`、`pnpm --dir desktop lint`、`pnpm --dir desktop source:lines`、`pnpm format:check`、`git diff --check`：通过。
- `pnpm bundle:check`：首屏 353.42 KiB、工作台 494.43 KiB，预算通过；`pnpm --dir desktop performance:budget`：退出 0。
- 复用此前 `pnpm test:performance` 的 16 项通过与 Web ACP 设置端到端的 12 项通过：后续修改仅作用于模型选项的 Tab 语义和草稿异步选择的作用域隔离，后续浏览器测试覆盖它们，未改动对应性能推导或 ACP 设置链路。
- 使用真实项目 `data-theme` 令牌检查了 360px / 1280px 的明暗主题截图，结果无横向溢出。
- 计划 preflight 通过，规范更新已格式化；公告仅清理本任务记录。

## 2026-11-14 模型预览故障与弱化入口

- 根因：生产 handlerTimeout 开启后，Fastify 原生 request.signal 在正常 POST 正文结束时被取消，ACP 模型预览随之失败；原有测试关闭超时，因此未复现。真实 HTTP 回归启用 60000ms 超时稳定得到 500，修复后得到 200。
- 错误协议：服务端返回 INTERNAL_ERROR，但客户端 Protocol 枚举缺少该值，导致原始错误被转换为 schema mismatch。先增加失败回归，再补齐枚举。
- 普通聊天此前缺少 ACP preview 公共 URL 重写；补齐精确的双引擎路由并验证正常 POST、断连取消和预览超时。
- 模型入口改为透明底、次级文字、小间距图标，展开和悬停均无背景色块。浏览器测试证明明暗主题和宽窄视口的透明背景与模型操作。
- 使用独立临时 HTTP 服务、生产超时及官方 ACP adapter 进行真实验证：Codex 项目/普通聊天各返回 10 个模型；Claude 项目/普通聊天各返回 5 个模型，默认选中值均存在；仅执行配置预览，没有发送 prompt 或创建应用任务。
- 现有 3211 Web 服务进程仍加载旧后端代码；未重启承载当前对话的进程，避免中断进行中的会话。构建产物已经更新，服务下次启动加载修复。

- 本次最终验证（源码修复后）：双端 build（含类型检查）通过；客户端/协议/服务端受影响套件 38 文件、158 项通过；新增模型预览、错误解码、公共路由与生成取消套件 25 项通过，测试风格修正后相应 20 项再通过。模型与双端 ACP 浏览器交互回归 28 项通过。
- `pnpm lint`、`pnpm lint:architecture`、桌面 lint、`pnpm format:check`、Web bundle 预算、`git diff --check` 通过。实际官方 adapter 的 HTTP 预览通过（Codex / Claude × 项目 / 普通聊天四个组合），临时服务与连接均已关闭。
- 简化结果：复用既有响应流取消工具，只增加可选超时文案，避免重复实现计时与清理。规范决策为 update，补充共享 UI 与 Server 索引；分类工具建议 create 是既有配置文件路径映射结果，本次不新建重复索引。

## 2026-11-14 紧凑控件与配置下拉

- 按用户追加要求移除模型列表中重复的 Agent 分组标题，缩小浮层宽度、标签、搜索行、模型行和底部动作，保留实际供应商分组。
- 原配置浮层替换为公共 CompactSelector，直接显示配置当前值；布尔配置使用带名称前缀的开/关下拉，不显示原始描述段落。思考量继续优先留在左侧，整个配置组参加现有自适应测量，窄屏转入“更多”。附件入口改为共享加号图标。
- 补齐官方 Claude 实际返回的 Manual / Effort 展示翻译；中文与英文即时切换不改写原始值或配置默认值。
- RED：新的配置下拉浏览器回归在原实现中无法定位“权限模式”按钮，两引擎均预期失败；GREEN：中文/英文公共下拉、原始字符串与布尔值传递通过。
- 复用边界：两端只调整共享控件及工具栏装配，不改 ACP 后端、配置协议或历史 Agent 锁定逻辑。

- 本次最终验证：Chromium / WebKit 共 34 项浏览器测试通过，涵盖双端输入框、无重复标题、附件加号、紧凑下拉、语言切换、360px 更多菜单和宽屏直出；相关 UI / Web / 翻译单元 97 文件、572 项通过。
- 双端 build（含类型检查）、根/桌面 lint、架构边界、格式、源码行数及 Web/桌面包体预算通过；明暗主题与窄屏截图已检查。
- 简化结果：changed，删除只供聊天使用的配置表单浮层，统一复用 CompactSelector；未新增渲染订阅、轮询或模型请求。规范更新在共享 UI 索引，明确覆盖此前“其他配置放入浮层”的约定。

## 2026-11-14 官方登录快速模式与思考右置

- “Plan”中文改为“计划”。思考拆成共享右侧控件，通过 ACP trailingControls 接入双端草稿和历史输入框；旧运行时思考同样回到模型后、发送前的常驻位置。
- 新增共享快速模式身份边界，复用 `acp-agent-profile` 查询；只挂载已公布该选项且有身份读取端口的 Codex 查询，不探测 Claude，不因身份查询阻塞提交。
- 只在 Codex 官方账号且无有效 API 覆盖时显示；API Key、自定义供应商、未知/失败/重新确认身份时直接隐藏。聊天、默认设置及计划选项使用同一边界，不写入或删除原始配置值。
- RED：原实现会在 API Key 登录时同时渲染聊天快速模式与设置开关；浏览器失败回归已确认。GREEN：身份矩阵、API 覆盖及账号变更即时隐藏通过；双端实际输入框断言思考位于发送之前。

- 本次最终验证：模型/输入框/身份矩阵浏览器回归 54 项通过，补充缓存变更与 API 覆盖后身份边界 20 项再次通过；相关 Web / UI 单元 97 文件、572 项通过。官方账号显示、API Key/网关/外部/未知/Claude 账号及生效 API 覆盖隐藏，未发生配置写入；同一身份查询复用缓存，仅 Codex 发出一次读取。
- 双端生产 build（包含类型检查）、根/桌面 lint、架构边界、格式、源码行数和包体预算通过。Web 首屏 353.43 KiB，工作台 494.41 KiB，均在原预算内。
- 简化审查为 no-change：认证边界由通用配置字段与聊天配置共用；思考复用原有 trailing 工具栏项，不复制控件或增加新布局观察器。
- 规范更新：共享 UI 索引记录官方登录判定、隐藏规则和思考右置；保留计划配置及所有原始值。

- 最终设置/认证浏览器套件 42 项通过；与模型、身份及双端输入框 54 项合计覆盖 96 项浏览器交互。原旧运行时已有 `official + connected + chatgpt` 快速模式判断，本次保留该一致语义。

## 2026-11-14 Agent 选择入口悬停反馈

- 移除模型触发器的 hover:bg-transparent 覆盖，直接继承公共 ghost 按钮的悬停背景与文字反馈，默认仍透明。
- RED：原有布局浏览器用例加入实际悬停断言后，Chromium / WebKit、360px / 1280px、明暗主题共 8 个条件均因背景保持透明而失败。

- GREEN：`pnpm --dir desktop test:browser tests/browser/acp-model-selector.browser.test.tsx` 共 22 项通过，覆盖明暗主题和宽窄视口的默认透明、悬停变色与正常选择。Web 与桌面构建通过，相关文件格式及 `git diff --check` 通过。简化为 no-change，复用公共按钮状态样式，无额外组件或逻辑。
