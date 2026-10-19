/*!
 * 图标来源：https://github.com/lobehub/lobe-icons/tree/master/packages/static-svg/icons
 * 使用 codex.svg 与 claude.svg，路径经 SVGO 精简到适合 14px 图标的精度。
 *
 * MIT License
 * Copyright (c) 2023 LobeHub
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { AgentEngine } from "@codexly/protocol";

const paths: Record<AgentEngine, string> = {
  codex:
    "M8 .5a6 6 0 0 1 3.1-.5q2.1.3 3.6 1.7h.1a6 6 0 0 1 4 .4h.1l.2.1a6 6 0 0 1 3.3 5.4l-.2 1.6v.2a6 6 0 0 1 1.7 2.8 6 6 0 0 1-1.2 5.2l-.2.2a6 6 0 0 1-3 1.9l-1 2a6 6 0 0 1-5 2.5 6 6 0 0 1-4.2-1.7h-.1l-1.6.1a6 6 0 0 1-2.6-.6A6 6 0 0 1 2.8 20l-.5-.8-.5-1.3a6 6 0 0 1 0-3v-.1a6 6 0 0 1-1.5-2.3L0 11l.2-2.1a6 6 0 0 1 4.2-4.3h.1a6 6 0 0 1 1.1-2.2A6 6 0 0 1 8.1.5m-.7 7.8a.8.8 0 0 0-1.5.8l1.7 3L5.8 15a.8.8 0 0 0 1.5.8l2-3.2a1 1 0 0 0 0-.9zm5.4 6.2a.8.8 0 0 0 0 1.7h4.9a.8.8 0 0 0 0-1.7z",
  claude:
    "m4.7 16 4.7-2.7.1-.2v-.2H5.6l-2.3-.2H1l-.6-.2-.5-.7v-.4l.5-.3h.7l1.5.2 2.3.1 1.7.1 2.4.3h.4v-.2l-.2-.2L7 9.8 4.4 8.1l-1.3-1-.7-.4-.4-.5-.2-1 .7-.7h.9l.2.1.9.7 1.9 1.5 2.5 1.8.4.3h.1v-.2l-.1-.2L7.9 6 6.5 3.5l-.7-1-.2-.6V1l.7-1 .4-.1 1 .1.4.4.6 1.4 1 2.2 1.6 3 .4 1 .3.8v.3h.2V9l.2-1.7.2-2 .2-2.8.1-.7.4-1 .7-.4.6.2.5.7v.5l-.4 1.8-.5 3-.4 1.9h.2l.3-.3 1-1.3 1.6-2 .7-.9.9-.9.5-.4h1l.8 1.1-.3 1.2-1 1.3-1 1.2-1.2 1.7-.8 1.3v.1h.3l2.8-.6 1.6-.3 1.8-.3.8.4.1.4-.3.8-2 .5-2.3.5-3.4.8 1.5.2h2.3l3 .3.8.5.5.6v.5l-1.3.6-1.6-.4-3.9-.9L16 14h-.2v.1l1.1 1 2 1.9 2.6 2.3v.6l-.2.5h-.4l-2.2-1.7-.8-.8-2-1.6v.2l.4.6 2.3 3.5.1 1.1-.2.4-.6.2-.6-.1-1.4-2-1.4-2.1-1.2-2-.1.1-.7 7.2-.3.4-.7.3-.6-.5-.3-.7.3-1.5.4-2 .3-1.4.3-2 .1-.6h-.1l-1.5 2-2.1 3L6.4 22l-.4.1-.7-.3v-.7l.5-.6 2.4-3 1.4-2 1-1v-.2h-.1L4 18.6l-1.1.1-.5-.4v-.8l.3-.2z",
};

export function AgentEngineIcon({ engine }: Readonly<{ engine: AgentEngine | undefined }>) {
  // 活动事件可能先于任务快照到达；预留同宽空间，避免误标品牌或补齐时标题跳动。
  if (engine === undefined) return <span aria-hidden="true" className="size-3.5 shrink-0" />;

  const label = engine === "claude" ? "Claude" : "Codex";
  return (
    <svg
      aria-label={label}
      className={`size-3.5 shrink-0 ${engine === "claude" ? "text-[#c15f3c] dark:text-[#d97757]" : ""}`}
      fill="currentColor"
      fillRule="evenodd"
      focusable="false"
      height={14}
      role="img"
      viewBox="0 0 24 24"
      width={14}
    >
      <title>{label}</title>
      <path clipRule="evenodd" d={paths[engine]} />
    </svg>
  );
}
