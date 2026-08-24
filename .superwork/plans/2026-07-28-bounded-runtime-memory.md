# 有界 Runtime 内存与 Task 释放

## Goal

消除长时间运行时由源码 Token、完整 Task Snapshot、未选中 Task Store、Command 输出和 Task 生命周期 Map 造成的无界内存增长，并在 Task 完成且不可见时安全释放 Codex Thread。

## Constraints

- 所有容量限制按 UTF-8 字节估算，并保留独立预算；Entry 数量只作为第二道保护。
- 有消费者的 Task Store 不得被回收；重新打开被回收的 Task 必须从权威 Snapshot 重新 Hydrate。
- `thread/unsubscribe` 只能在无运行 Turn、无 Pending Request、无后台终端、无读取或恢复 Promise 时调用。
- 归档和释放必须幂等；清理缓存不能阻断导航或破坏 Project 级轻量事件订阅。
- 不保留旧的无界实现或仅依赖 TanStack Query 默认 5 分钟回收。

## Tasks

- [x] 1. 增加可测试的按字节 LRU 与保守对象字节估算工具。
- [x] 2. 将 CodeBlock Token 缓存改为按字节 LRU，并跳过超大源码缓存。
- [x] 3. 为 Task Runtime Store 增加按字节的非活动 LRU，并对单 Task Command 输出实施独立总字节预算。
- [x] 4. 为 Task Snapshot Query 设置明确 `gcTime`，并增加非活动 Snapshot 的按字节 LRU 回收。
- [x] 5. 增加 Provider 无关的 Task unsubscribe 能力、Server/Client 路由和 Web 最后消费者释放调用。
- [x] 6. 归档成功后清理 Snapshot、Task Store、taskActivity，并由 Codex Provider 清理 taskOwners/contextUsage 等 Task Map。
- [x] 7. 更新持久规范，运行聚焦测试、类型检查和完整校验。

## Verification

- `pnpm exec vitest run <focused test files>`
- `pnpm typecheck`
- `pnpm check`

## Stop Conditions

- 固定 Codex 版本生成的 experimental Schema 不包含 `thread/unsubscribe` 或响应状态与设计不一致。
- Provider 无法在不丢失运行 Turn、Pending Request 或后台终端通知的前提下判定安全释放。
- 实现要求改变实时 checkpoint 或历史分页协议；此时返回设计阶段重新定界。
