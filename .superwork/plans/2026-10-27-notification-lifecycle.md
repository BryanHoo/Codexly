# 通知生命周期与资源修复

- 调用链：superwork-start → superwork-debugging → superwork-tdd → superwork-check。
- 协作身份：notifications-lifecycle-20261027 / codex-notifications-lifecycle。
- 原因证据：macOS 主线程两次采样分别约 98.9%、98.3% 等待 deliveredNotifications；清除通知后降至约 0.1%。
- 保持审批和异步问题的业务状态不变，通知仅负责提醒与导航。

## 实现与验证

- [x] 原生通知使用事件回调，移除 macOS 轮询和 Linux 每通知一个阻塞线程；Windows 发送离开异步事件处理线程，最多两个同步 WinRT 操作并行。
- [x] 原生通知按任务替换、限制保留数量，任务确认和禁用通知时撤销。
- [x] 共享通知历史限制条目、字节和任务去重元数据，旧数据恢复时同步裁剪。
- [x] Web 通知按任务替换、处理失效和关闭通知时回收；普通 Token 不读取偏好、权限和焦点。
- [x] 完成行为测试、类型、静态检查、原生构建和性能验证，记录平台限制。

## 官方依据

- Apple delegate：https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/delegate
- Apple 异步移除：https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/removedeliverednotifications(withidentifiers:)
- Freedesktop 通知信号：https://specifications.freedesktop.org/notification/latest-single/
- notify-rust 异步 API：https://docs.rs/notify-rust/4.18.2/notify_rust/struct.NotificationHandle.html
- Windows 事件：https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotification.activated

## 证据

### RED / GREEN

- 历史裁剪：`node node_modules/vitest/vitest.mjs run packages/frontend-core/src/task-notification-retention.test.ts --maxWorkers=1` 最初两项分别以 1200、2000 条超过 500 的断言失败；实现后通过。
- 原生回收：`cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked --lib notification_delivery::tests --jobs 2` 最初替换、容量淘汰、确认清理三个行为失败；实现后通过。补充禁用并发登记回归，先确认旧 token 未取消的失败，再实现同锁禁用；旧请求不能撤销新问题也有回归。
- Web 回收：初始新通知替换、偏好关闭、64 条上限三项均以 close 调用为 0 失败；实现后通过。Token 回归先确认偏好读取两次，再增加热路径过滤，最终不再读取偏好或权限。
- 新原生命令的既有 ACL 测试先发现缺少清单与窗口授权，补齐 `build.rs` 和主窗口权限集后通过。

### 验证账本

以下命令均从仓库根目录执行，另行标记的 desktop 测试从 desktop 执行；通过表示退出码 0。

- 根完整测试 `node node_modules/vitest/vitest.mjs run --maxWorkers=2`：652 文件、3713 项通过，既有 28 项跳过。后续仅 Web Token 过滤和无运行时影响的类型/格式修订，相关 `apps/web/src/features/notifications`、`apps/web/src/features/conversation/runtime` 与共享通知测试再验证，34 文件、202 项通过；最终通知与历史用例 22 项通过。
- 桌面完整前端测试：`node node_modules/vitest/vitest.mjs run --maxWorkers=2`（desktop）：164 文件、647 项通过。
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --all-features --locked --jobs 2`：809 项单元、6 项集成通过，9 项既有手动性能/平台用例跳过。最后一次 macOS 回调参数持有顺序修订后，通知相关 26 项再验证通过。
- `cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets --all-features --locked --jobs 2 -- -D warnings`、两端 TypeScript 类型与 lint、三份 Rust manifest 的 fmt 检查通过。
- `pnpm --dir desktop tauri:constraints:test`：65 项通过，Windows 资源采样一项在当前 macOS 环境跳过；主窗口权限覆盖新增通知回收命令。
- `pnpm --dir desktop test:browser src/features/workbench/components/sidebar-notifications.browser.test.tsx src/features/notifications/toaster.browser.test.tsx --maxWorkers=1`：Chromium / WebKit 共 10 项通过。
- `pnpm exec playwright test tests/e2e/app-shell-notifications.spec.ts --workers=1`：最终 Web 构建下 Chromium / Firefox / WebKit 的 1280px、320px 共 6 项通过。
- `pnpm test:performance --maxWorkers=1`：17 项通过；Web 构建与 bundle 检查通过，初始包约 313 KiB，低于 320 KiB 门槛。
- `pnpm --dir desktop build`、`build:legacy`、`performance:budget`：现代与 Legacy 构建及包体预算通过。
- Windows 原生适配 crate 及实时包含生产发送器源码的隔离检查在 `x86_64-pc-windows-msvc` 下通过；Linux 生产发送器在 `x86_64-unknown-linux-gnu` 下通过，并静态验证 future 可 Send。隔离检查位于 `/tmp/codexly-notification-cross-check`，使用真实 notify-rust / Windows 依赖和宿主接口替身，不能等同于整应用跨系统运行。
- `pnpm lint:architecture`：0 错误；现有 `packages/server/src/sqlite-journal.d.ts` 孤立声明产生 1 条非阻塞警告，本次未修改。
- `pnpm format:check`、`git diff --check` 通过；临时独立 crate 检查产生的锁文件与 target 已清理，根 Cargo manifest/lock 未变化。
- `CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=false cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib performance_baseline --release --locked --jobs 2 -- --ignored --nocapture --test-threads=1`：6 项 Release 性能基线通过；冷编译完成后测试运行约 29 秒。

### 收尾决策与限制

- 简化审查：changed。裁剪器仅依赖最小摘要类型，消除存储与裁剪模块的类型依赖环；发送器按平台隔离，有界回收策略复用。相关架构和行为验证通过。
- 规范决策：update。已在桌面后端和 Frontend Core 索引记录事件驱动、容量预算、已读回收和禁用并发边界，并更新会话性能说明。
- 当前机器为 macOS；Windows / Ubuntu 的真实系统通知权限、点击及桌面服务重启，以及 macOS 已安装新包后的真实通知行为仍需对应环境验收。本任务未替换正在运行的 Codexly.app，也未发布版本。
