# 前端组件规范

## 规则

- 功能组件放入对应 `features/<feature>/components`，跨功能基础组件复用 `shared/components/core`。
- 优先组合现有 Radix UI 基础组件，并使用 `lucide-react` 图标；保持键盘操作、焦点和可访问名称完整。
- 通过明确的 props 或现有 Context 传递依赖，避免组件直接创建网络客户端或全局单例。
- 复杂组件拆分渲染、状态和数据转换职责，单个代码文件保持在 500 行以内。
