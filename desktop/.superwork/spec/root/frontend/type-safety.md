# Web 前端类型安全

## 规则

- 保持 TypeScript `strict` 检查通过，不使用 `any` 绕过边界
- 传输契约集中定义在 `src/protocol/`，组件不得重复声明对应结构
- 桌面 `NativeClient` 只公开有真实 Tauri 实现的能力，不得保留 Web 时代的空实现、无调用方接口或必然抛错的占位方法
- `src/client/` 的每个响应都使用协议 Schema 校验，mock 响应也必须满足同一契约
- 可辨识联合的 `type` 标签、事件 envelope 与 HTTP 响应字段保持一致
- 捕获外部错误时使用 `unknown`，在边界内完成收窄或转换
