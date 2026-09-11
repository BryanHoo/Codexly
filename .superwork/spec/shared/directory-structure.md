# 共享目录结构

## Purpose

Document how reusable code should be organized for this project.

## 规则

- `packages/protocol/src` 保存 Provider 无关的公开协议、TypeBox schema、Agent Event 和控制帧。
- 定时任务墙钟时间转换作为前后端共用的纯工具通过 `@codexly/protocol` 导出；明确指定任务时区，不依赖宿主时区，校验时拒绝不存在的日期和夏令时时间。
- `packages/core/src` 保存领域模型、用例和端口，不承载 HTTP、数据库或浏览器实现。
- `packages/*/src/index.ts` 是包的公开出口；跨包导入使用 `@codexly/*`，不穿透其他包内部路径。
- Web 内部的 `apps/web/src/shared` 只服务前端，不得作为 Node 包间共享层。
