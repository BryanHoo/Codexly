# AI Elements 来源与本地适配

共享聊天组件按照 [shadcn/ui AI Elements](https://ui.shadcn.com/docs/ai-elements) 的官方迁移指南实现。基础样式参考 2026-10-28 的 radix-nova registry；滚动行为使用锁定的 `@shadcn/react@0.3.1`。

`src/core` 的 Message、Bubble、Trace、Code Block、Attachment、Item 等组件来自该组合规范；按项目需要裁剪未使用变体，并映射到已有主题 token。输入组件沿用项目的 Radix、Button 和 Textarea 底层，增加新版 Input Group 槽位。`src/agent` 只保留一套共享组合，由两端注入翻译和平台动作。

本地优化包括真实 DOM 的分页会话、屏外绘制跳过、流式绘制前的滚动校准、阅读锚点补偿、折叠输出卸载、增量 Markdown 与按需高亮。它们不修改双引擎传输协议。

视觉与状态对齐 [Trace 官方 Replay](https://ui.shadcn.com/docs/components/base/trace)：共享状态图标、运行扫光、自动思考展开与可完成退出的折叠。新增条目使用有界、稳定身份的原生入场动画；历史和 token 更新不重放，遵循减弱动态效果设置，不引入动画库。

上游组件遵循以下 MIT 许可。
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
