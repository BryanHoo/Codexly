# 代码复用检查

## Goal

Reduce duplicated logic before it spreads across the project.

## 检查项

- 先在当前 feature、`apps/web/src/shared` 和相关 `packages/*/src` 搜索现有实现。
- 仅在多个真实消费者共享同一契约时抽取公共模块。
- 跨包复用通过公开 `index.ts` 出口完成，不建立内部路径耦合。
- 新抽象若形成稳定规则，同步更新对应层规范。
