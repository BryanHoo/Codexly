import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

/** 两端共用请求互斥与草稿归属检查；异步结果不能覆盖后来编辑或其他会话。 */
export function PromptOptimizationButton(
  props: Readonly<{
    language: string;
    scope: string;
    text: string;
    disabled: boolean;
    generate: (text: string, signal: AbortSignal) => Promise<{ text: string }>;
    replace: (text: string) => void;
    onError: (error: Error) => void;
  }>,
) {
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const active = useRef<AbortController | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const revision = useRef(0);
  const previous = useRef({ scope: props.scope, text: props.text });
  if (previous.current.scope !== props.scope || previous.current.text !== props.text) {
    revision.current += 1;
    previous.current = { scope: props.scope, text: props.text };
  }
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
    };
  }, []);
  useEffect(() => {
    // 草稿失去归属时停止传输与后端辅助会话；revision 继续防御忽略取消的旧调用方。
    return () => {
      active.current?.abort();
    };
  }, [props.scope, props.text, props.disabled]);
  const zh = props.language.startsWith("zh");
  const label = pending
    ? zh
      ? "正在优化提示词…"
      : "Optimizing prompt…"
    : zh
      ? "AI 优化提示词"
      : "Optimize prompt with AI";
  const optimize = async () => {
    if (lock.current || props.disabled || !props.text.trim()) return;
    lock.current = true;
    setPending(true);
    const started = revision.current;
    const controller = new AbortController();
    active.current = controller;
    try {
      const result = await props.generate(props.text, controller.signal);
      // 即使用户修改后又恢复同文，也不接管已经发生过编辑的草稿。
      if (mounted.current && started === revision.current && !latest.current.disabled) {
        const text = result.text.trim();
        if (!text) throw new Error(zh ? "优化结果为空" : "The optimized prompt is empty");
        latest.current.replace(text);
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && started === revision.current)
        latest.current.onError(
          new Error(zh ? "提示词优化失败，请重试" : "Prompt optimization failed. Please retry.", {
            cause: error,
          }),
        );
    } finally {
      if (active.current === controller) active.current = null;
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  };
  // 空正文（含纯空白或仅附件）不展示优化入口；保留上方 Hook，以免清空时破坏异步草稿归属检查。
  if (!props.text.trim()) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          aria-label={label}
          aria-busy={pending}
          disabled={props.disabled || pending || !props.text.trim() || props.text.length > 32_000}
          onClick={() => {
            void optimize();
          }}
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Sparkles aria-hidden="true" className="size-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
