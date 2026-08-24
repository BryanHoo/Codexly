# Sidebar Task Refill and Full Search Plan

**Goal:** 左栏常规 Task 列表继续按 Project 首屏展示最近 5 项；归档后立即从服务端校准并补足最新 5 项；输入搜索词后按需读取所有 Project 的完整 Task 历史再过滤。

**Architecture:** 保留常规列表的 5 项 Cursor Infinite Query。搜索使用独立、按 Project 缓存的全量数据源，只有非空搜索词时启用；不同 Project 并行读取，各 Project 内按 Cursor 顺序读取。归档成功后先从现有缓存移除，再重新校准活动 Infinite Query，并同步清理搜索缓存。

## Task 1: Add query behaviors with tests

- [x] **Task Status:** completed

- 覆盖搜索数据源追踪全部 Cursor、跨页去重与重复 Cursor 停止。
- 覆盖归档后活动第一页重新读取并恢复最近 5 项。
- 关键逻辑添加简短中文注释。

## Task 2: Connect full search and archive refill to Sidebar

- [x] **Task Status:** completed

- 使用专用 Hook 在非空搜索时读取全量 Task，不让 Sidebar 直接访问 Client。
- 搜索加载和失败必须可见，完整结果就绪后再替换普通分页数据。
- 归档成功后校准对应 Project 的普通列表和搜索数据源。

## Task 3: Update durable specs and verify

- [x] **Task Status:** completed

- 更新前端组件与状态规范，删除“搜索只匹配已加载数据”的旧约束。
- 运行聚焦 Vitest、TypeScript/格式检查以及仓库标准门禁；所有命令使用明确超时。
