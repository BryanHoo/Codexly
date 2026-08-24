# 共享模块与依赖边界

## Scope

适用于 `packages/protocol`、`packages/core`、`packages/client` 及所有跨包公共入口。

## Guidelines Index

| 指南                                   | 内容                         |
| -------------------------------------- | ---------------------------- |
| [目录与依赖](./directory-structure.md) | 包职责、允许依赖和公开入口   |
| [质量规范](./quality-guidelines.md)    | Schema、类型、契约和验证要求 |

## Pre-Development Checklist

- 读取 `.superwork/spec/guides/index.md` 和本层全部指南。
- 对照本目录的 [目录与依赖](./directory-structure.md) 确认依赖方向。
- 修改公开协议前列出所有调用方、持久化影响和事件恢复影响。
