# 公开协议与共享数据契约

## 位置与职责

`packages/protocol/src` 维护 Provider 无关请求 / 响应、JSON Schema、Agent Event、控制帧和 checkpoint。公开导出由本包 `package.json` 定义；边界说明见 [Protocol README](../../../../packages/protocol/README.md)。

## 契约与检查项

- [ ] 保持内部依赖图最底层，不导入其他内部包，也不承载运行时编排或 Provider 专有逻辑。
- [ ] 协议变化同时核对 Client、Server、两种 Provider 及桌面原生 / 前端映射，并更新契约测试和 `CHANGELOG.md`。
- [ ] 修改 `local-catalog-schema.json`、`app-storage-migration.json`、`token-usage-sql.json` 时同步验证 Node / Rust 消费者和同机共享存储兼容性。
- [ ] 执行 `pnpm exec vitest run packages/protocol/src`、`pnpm typecheck`、`pnpm lint:architecture`；按影响补充消费者测试。

事实来源：[本地目录与任务](../../../../docs/local-catalog.md)、[用量统计](../../../../docs/usage-statistics.md)、[跨层契约](../../guides/cross-layer-thinking-guide.md)。

## Web 诊断契约

- `packages/protocol/src/diagnostics.ts` 定义 `DiagnosticsResponseSchema` 和 `DiagnosticsResponse`，由 Client `getDiagnostics()` 与 Server `GET /v1/diagnostics` 共用；版本固定为 1，包含导出时间、运行环境、脱敏 JSON 日志行和淘汰计数。该 HTTP 快照不替换桌面原生 ZIP 导出协议。
- 同文件的 `SaveDiagnosticsRequestSchema` / `SaveDiagnosticsResponseSchema` 定义整合 ZIP 的准备请求与下载描述。请求只携带有界应用快照字符串，不接受宿主路径；响应仅包含随机下载标识和文件名。Web 与桌面导出均默认尝试 `feedback/save`，原生结果纳入 `codex/diagnostics.zip`；不可用时保留应用诊断并在 `manifest.json` 中标注 `codexDiagnostics.status: unavailable`，不调用 `feedback/upload`。

## 归档日期清理契约

- `DeleteArchivedTasksRequestSchema` 支持可选 ISO 日期时间 `updatedBefore`；省略表示全部归档，提供时仅删除最后更新时间严格早于截止点的任务。界面选择日期时，两端按用户本地日历零点转换，不含截止日期当天；月份快捷选项按自然月并截断月底日期。
- 删除范围覆盖全部归档分页，不受当前搜索影响；确认弹窗固定截止点，空白或无效自定义日期不得回退为全部删除。HTTP 在 AJV 移除额外字段前拒绝未知筛选，幂等指纹包含截止点。
- 先收集目标再按最多 4 项并发删除。Core 在执行前复查更新时间，防止收集后新更新的任务误删；桌面保持原生删除链路。两端复用 `packages/frontend-core/src/archived-task-deletion.ts` 与 `packages/ui/src/core/archived-task-delete-control.tsx`，搜索加载不能重置日期范围。
- 验证入口：`packages/core/src/archived-task-deletion.test.ts`、`packages/server/src/app-archived-task-deletion.test.ts`、`tests/e2e/app-shell-archived-tasks.spec.ts` 及桌面 `archived-task-delete-all.test.ts`、`archived-tasks-dialog.browser.test.tsx`。

## 项目树创建文件与文件夹

- `CreateProjectFileRequest` 使用 `{ parentPath: string | null, name, type: "file" | "directory" }`；null 表示选定项目根。HTTP `POST /v1/projects/:projectId/files/create` 沿用根目录授权和幂等，桌面通过原生 `create_project_file` 命令并显式注册主窗口 ACL。两端响应为 `{ path, tree }`，tree 是父目录权威快照。
- 新建操作使用可移植名称子集，拒绝分隔符、控制字符、Windows 保留名和末尾点/空格；父目录必须在真实项目根内，不能经符号链接逃出。使用 Node 独占 `wx`、Tokio `create_new` / `create_dir`，同名报 `PROJECT_FILE_CONFLICT` 并保留原内容，不能先检查存在再写入。
- 创建弹窗与菜单共用 `packages/ui/src/core/project-file-creation.tsx` 和 `project-file-creation-menu.tsx`；校验、同步提交锁、错误保留名称及焦点行为一致。菜单进入弹窗时阻止菜单关闭抢回焦点；取消不写入，提交期间锁定关闭，关闭后回到对应目录。
- 创建响应直接更新父目录缓存，等待 Headless Tree 子项刷新完成后再展开目录；不能在 loading 期间调用 expand，因为会被忽略。保留其他目录展开状态，不轮询或重载整树。
- 回归入口：`packages/server/src/project-file-creation.test.ts`、`app-file-creation.test.ts`，Rust `workspace::file_creation`，桌面 `project-file-creation.browser.test.tsx`，Web `tests/e2e/app-shell-file-creation.spec.ts`。覆盖独占创建、越界、中文名、根/子目录菜单、提交互斥、错误恢复，以及三浏览器与真实触屏。
