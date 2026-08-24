# Hook 与副作用规范

## Purpose

约束 HTTP Snapshot、WebSocket 事件和浏览器副作用的封装方式。

## Rules

- Hook 按提供的行为命名，不以页面或实现细节命名通用 Hook。
- HTTP 与 WebSocket 访问统一经过 `packages/client`，组件不得手写协议解析。
- 每个订阅必须处理取消、重连、重复事件与组件卸载清理。
- TanStack Query 的 `queryFn` 必须把上下文 `signal` 透传到 `packages/client`；Client 将其与本地超时组合，Task、Project 或查询键切换后旧 HTTP 响应不得继续进入 Schema 校验和 Query Cache。
- 按界面消费状态懒加载的 Query 必须让关联 Effect、轮询和显式 `refetch()` 服从同一 `enabled` 条件；禁用期间不得从旁路发起请求，重新启用后由 Query 读取最新数据。
- Hook 返回明确的加载、错误和终态，不用异常或隐式全局变量传递状态。
- Mutation controller 必须在用户事件入口直接执行网络操作，并以当前 Project/Task 作用域隔离锁、幂等尝试、附件上传和异步结果；路由切换后旧作用域结果不得写回，清理时必须同步重置提交状态、临时缓存和未完成尝试。
- Delta 合并留在实时状态边界，组件只消费可渲染状态。
- Browser Notification API 必须封装在独立 Feature 适配器中，由共享 Project 实时事件入口对完成、不可恢复中断或错误、审批和用户输入触发；`document.visibilityState === "visible"` 且 `document.hasFocus()` 时视为页面前台并禁止发送，其他状态才允许使用 Runtime 提供的 Task 名称构造通知。权限只在 Task 启动用户手势内申请，不支持、拒绝或构造失败时静默降级且不得中断事件链路，同一 Turn 的不可恢复错误与随后失败终态必须去重。
