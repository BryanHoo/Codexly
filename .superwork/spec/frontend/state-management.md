# 前端状态管理

## Purpose

Track where local, shared, and remote state should live in this project.

## 状态归属

- 临时交互状态默认留在组件或最近的功能 Hook 中。
- HTTP 服务端状态使用 TanStack Query；查询 key 和 mutation 行为集中在对应功能模块。
- 项目、访问控制和编辑器草稿等跨组件状态使用现有 Context；不要新增重复的全局状态源。
- Agent 事件、快照和重放状态保持在 `features/conversation/runtime` 的专用 store 中，并遵守现有内存上限。
- 持久化偏好继续使用对应功能已有的浏览器存储适配器。
- 应用更新进度作为 HTTP 服务端状态交给 TanStack Query；仅在更新 mutation 活跃时轮询独立进度端点，空闲后停止轮询，不在组件中维护重复定时器。
