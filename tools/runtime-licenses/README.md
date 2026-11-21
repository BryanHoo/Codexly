# 桌面 ACP 宿主许可

`build-acp-runtime.mjs` 随桌面宿主分发以下许可。

- `BUN-LICENSE.md` 来自 [Bun bun-v1.4.2](https://github.com/oven-sh/bun/blob/bun-v1.4.2/LICENSE.md)，包含依赖许可与 JavaScriptCore 重新链接说明。
- `ACP-SDK-LICENSE` 来自工作区锁定的 ACP SDK。

宿主源码位于 `packages/provider-acp/src/main.ts`，可通过 `tools/build-acp-host.mjs` 用 Bun 重新编译。官方 Agent 通过 ACP 目录按需安装。
