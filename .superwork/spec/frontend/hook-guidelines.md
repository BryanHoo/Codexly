# 前端 Hook 规范

## 规则

- Hook 使用 `use` 前缀，并留在消费它的功能目录；只有跨功能复用后才移动到 `shared`。
- HTTP 查询和 mutation 复用功能内现有 TanStack Query key、缓存更新与失效策略。
- WebSocket、事件监听、定时器和浏览器 API 必须在 effect 清理函数中释放。
- 对外返回稳定且最小的状态与动作集合，明确暴露 loading、error 和取消状态。
