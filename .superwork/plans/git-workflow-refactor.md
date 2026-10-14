# Git 工作区重构实现计划

**Goal:** 在 Web、移动 Web 和桌面端提供保留草稿、准确提交范围及可继续处理推送失败的 Git 工作区。
**Scope:** 共享前端状态与控件、Git 消息上下文、远端协议及两端执行适配；不自动改写历史或强制推送。
**Acceptance:** 刷新和重新打开保留提交信息，每次打开默认全选，AI 生成成功直接替换全文并可撤销，部分暂存上下文与提交一致，远端入口始终可用且错误提供对应处理动作。

### Task 1: 保留草稿与统一提交范围

**Files:**

- Modify: `packages/frontend-core/src/git-commit-draft.ts`
- Modify: `packages/server/src/git-commit-message.ts`
- Modify: `desktop/src-tauri/src/infrastructure/workspace/git_commit_context.rs`
- Test: `packages/frontend-core/src/git-commit-draft.test.ts`
- Test: `packages/server/src/git-commit-message.test.ts`

**Behavior:** 按仓库、工作树及分支保存文本草稿，每次打开默认全选当前文件，同次打开内刷新保留选择，新变更不静默加入；部分暂存只生成将提交的内容。
**Proof:** `pnpm exec vitest run packages/frontend-core/src/git-commit-draft.test.ts packages/server/src/git-commit-message.test.ts`
**Stop Conditions:** 现有原生提交范围语义与服务端不同且不能通过明确适配统一时停止该切片并重新核对。

- [x] **Task Status:** completed

### Task 2: 共用提交工作区和 AI 生成

**Files:**

- Modify: `packages/ui/src/core/git-commit-workspace.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-panel.tsx`
- Modify: `desktop/src/features/workbench/components/commit-changes-panel.tsx`
- Test: `apps/web/src/features/workbench/components/commit-changes-panel.test.tsx`

**Behavior:** 顶部常驻远端动作，中间单份文件列表，底部草稿；生成成功直接替换并可撤销，过期范围结果不覆盖当前内容，成功提交才清除草稿。
**Proof:** Web 组件回归和桌面 browser 回归，加 Chrome CDP 窄屏与宽屏验证。
**Stop Conditions:** 必须引入未授权外部发布才能验证时使用本地临时仓库。

- [x] **Task Status:** completed

### Task 3: 远端状态、发布及失败恢复

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/server/src/routes/project-git-push-routes.ts`
- Modify: `desktop/src-tauri/src/application/workspace_commands.rs`
- Modify: 两端客户端和提交 controller
- Test: Git 临时仓库集成及协议测试

**Behavior:** 展示远端目标、领先落后状态；首次发布设置上游；失败按原因提供下一步操作，拉取仅允许快进，分叉和未完成 Git 操作交给外部工具处理后刷新，未知结果先检查。
**Proof:** 临时 bare 远端验证发布、仅快进更新、分叉拒绝、只读未完成操作检测和重试；两端类型检查。
**Stop Conditions:** 凭据缺失只验证本地远端和恢复文案，不向用户真实仓库推送。

- [x] **Task Status:** completed

### Task 4: 跨端验收与文档

**Files:**

- Modify: `docs/git-workflow.md`
- Modify: `.superwork/spec/` 相关层说明
- Test: 两端相关测试、类型检查、lint、生产构建

**Behavior:** 宽窄屏可操作、分页选择无歧义、共享边界保持、关键路径低开销。
**Proof:** 相关回归、构建、Chrome CDP 操作和最终 diff 检查。
**Stop Conditions:** 环境或无关基线失败须单独记录，不将其伪称为变更通过。

- [x] **Task Status:** completed

## 验证记录

- Web 全套测试、发布测试、性能测试、类型检查、格式、lint、架构、构建、传输体积预算和包验证通过（低并发完整检查）。并行 Rust 优化构建时有未改动服务用例超时，停止竞争后单独复测 35 项全部通过，再完整检查通过。
- Desktop `check:web` 通过 541 项单元测试、平台约束和常规/旧版构建，`check:rust` 通过 726 项 Rust 单元测试及 6 项 release 性能基准。
- Chrome CDP 验证手写内容不被 AI 覆盖、刷新/重开保留草稿与选择、错误分类重开恢复、390px 窄屏和 300px 可用高度下主操作可达。新增紧凑布局 browser 回归，浏览器自动化用例只做了加载检查；实际交互验证使用用户 Chrome。
- 所有远端写操作验证使用临时本地 bare 仓库，没有推送用户真实远端。
- 此轮完成 P0/P1 核心工作区；按代码块提交、AI 拆分和高级历史操作按原方案留在 P2。

## 交互精简跟进

- 底部仅保留完整提交信息输入框和提交/提交并推送；移除详细描述、重复提示和推送已有提交菜单项。
- 远端请求按真实 action 展示进度，配置使用共享表单弹窗，保存失败保留输入，成功关闭并恢复焦点。
- 组件 RED 验证了旧版获取动作显示推送、双输入框及底部提示；GREEN 的 19 项组件测试通过。Chrome CDP 分别挂载两端真实面板验证获取进度、弹窗与菜单，验证保存失败重试、多行 AI/提交内容和 390×844 / 390×300 布局。
- 同步使用指南、两端规范、现有提交 E2E 用例，并补充远端交互 browser 回归；浏览器套件未启动独立浏览器，交互验收使用用户 Chrome CDP。
- 最终 `CI=1 pnpm check` 通过：2528 项单元测试、15 项性能测试、lint/架构/类型、构建与体积/包验证；桌面 `check:web` 通过 541 项单元测试及常规/旧版构建。最后仅新增浏览器测试布局约束和文档记录，已补验桌面类型/lint及相关文档格式。

## AI 生成直接应用跟进

- 按最新交互要求，点击生成后成功结果直接替换当前全文，移除覆盖确认及待确认建议状态，保留撤销；失败或提交范围变化时保留文本。旧草稿仍可读取，待确认建议不再恢复。
- RED 验证旧逻辑不会覆盖已有文本及生成期间的编辑；GREEN 的草稿、编辑器及提交面板 29 项回归通过。同步提交 E2E 与使用指南。
- 最终 `CI=1 pnpm check` 通过 2532 项单元测试、15 项性能测试及完整构建/检查；桌面 `check:web` 与最后的类型/lint 检查通过。Chrome CDP 分别验证两端直接替换与撤销，Web 另外验证生成期间编辑、失败及过期范围保护；浏览器自动套件只做加载检查。

## 全选默认与审查提示移除跟进

- 移除范围提示、已审查按钮、needsReview 状态及持久化字段，旧草稿忽略该字段；保留快照/选择对过期 AI 结果的校验。
- 每次打开全选当前文件，恢复提交信息与撤销内容；异步首批详情到达时补足全选，当前打开内保留手动排除及分页范围。
- RED 验证旧逻辑仅选暂存、复用旧排除、首批详情未选和审查状态残留；GREEN 的相关 32 项回归通过。
- 最终 `CI=1 pnpm check` 通过 2535 项单元测试、15 项性能测试及完整检查/构建；桌面 `check:web`、补充类型/lint检查通过。Chrome CDP 分别验证两端默认全选、刷新保留排除、重开全选保留文本、首批详情异步全选及审查提示消失。新增浏览器回归，自动浏览器套件未整跑，交互验收使用用户 Chrome。

## 撤销入口布局跟进

- 将撤销生成移到 AI 生成左侧，同一行显示，取消输入框下方独立行；共享组件让 Web 与桌面同步生效。
- Chrome CDP 的位置检查在旧布局失败，移动后通过；320px 下两端样式无横向溢出，按钮垂直中心一致，撤销恢复原文。现有编辑器与面板 21 项回归通过；两端类型/lint及共享架构检查通过。

## 提交后推送恢复与错误反馈跟进

- 复现旧快照阻止只读检查，随后旧缓存 HEAD 阻止推送；另用 QueryClient 复现相同分支的新快照仍复用旧元数据。
- inspect 保留根仓库验证并允许旧快照读取；共享网络 Mutation 先检查当前 HEAD 再执行，保留分支/HEAD 防并发校验，远端缓存按快照隔离并短时回收。
- 错误集中顶部，标题与处理建议按应用语言显示，原始日志仅折叠详情；移除重复错误与 toast，空变更区域留白。
- RED 的 13 项旧行为失败及缓存复用失败已验证；GREEN 的 61 项相关回归及原生本地远端回归通过，继续验收完整检查与中英文交互。
- 最终 `CI=1 pnpm check` 通过 2552 项单元测试、15 项性能测试与完整构建/检查；桌面 `check:web` 通过 541 项单元测试及常规/旧版构建，`check:rust` 通过 726 项单元测试及 6 项 release 性能基准。Chrome CDP 分别挂载两端真实控制器，用模拟客户端验证单一错误卡片、中英文切换、折叠技术详情、空区域留白，以及 Commit 后 Push 绑定新 HEAD 并成功收尾；实际 Git 推送验收仅使用临时本地 bare 远端。相关 E2E 已同步并验证加载，未启动独立浏览器套件。

- 2026-10-14：顶部重设计为两行状态工具栏与单一下一步，次要信息按需在菜单/弹窗展示。按最新产品范围移除全部应用内冲突处理动作及路径协议；拉取改为仅快进，分叉或未完成操作在外部 Git 工具处理后刷新。

## 顶部模块重设计与固定高度跟进（2026-10-14）

- 两端共用两行操作区：分支与推送目标、同步数量和一个匹配当前状态的主操作。次要操作进入更多菜单，远端元数据、完整建议与错误日志通过弹窗按需查看。
- 顶部固定为 112px，预留一行提示空间；正常状态无额外提示，失败只保留短原因和详情入口。长分支、双向计数、长中英文说明与弹窗开关都不得挤动文件列表。
- 删除应用内冲突编辑、解决标记、完成和取消合并的 UI、协议与两端执行分支。拉取仅允许快进；分叉及未完成 Git 操作交给外部工具处理后刷新。
- 状态变化导致推送失败后，显式刷新可恢复正确的推送入口；本地检查不能宣称连接或认证问题已修复。错误与操作说明按应用语言显示，详情关闭后恢复入口焦点。
- Chrome CDP 实测两端中英文和 320px 窄屏，各状态高度均为 112px，无横向溢出；覆盖失败详情、外部处理说明、键盘关闭和焦点恢复。新增真实布局 browser 回归，浏览器套件只做加载检查，实际交互沿用用户 Chrome。
- 最终 `CI=1 pnpm check` 通过 2586 项单元测试、15 项性能测试及完整发布/构建/体积/包检查；桌面 `check:web` 通过 541 项单元测试与常规/旧版构建，`check:rust` 通过 730 项单元测试、集成测试及 6 项 release 性能基准。

## 紧凑状态徽标跟进

- 顶部由 112px 收紧到固定 72px，不再预留提示行；分支目标位于第一行，状态徽标和 24px 小号主按钮位于第二行，主按钮始终靠右。
- 保留待推送的蓝色可点击徽标，将已同步及其他常规状态改为相同尺寸与内边距的徽标。错误与说明在当前状态行按需显示，完整内容仍在详情弹窗中。
