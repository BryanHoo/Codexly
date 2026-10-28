import { createContext, memo, useContext, useLayoutEffect, useMemo, useRef } from "react";
import {
  Block,
  CodeBlockContainer,
  CodeBlockCopyButton,
  CodeBlockDownloadButton,
  CodeBlockHeader,
  Streamdown,
  StreamdownContext,
  type BlockProps,
  type StreamdownProps,
} from "streamdown";
import type { SequenceNode } from "@codexly/frontend-core/persistent-sequence";
import type { MarkdownBlockTree } from "@codexly/frontend-core/incremental-markdown-blocks";
import type { CodeLineTree, MarkdownBlock } from "@codexly/frontend-core/streaming-markdown-block";
import { separateBoldTitleFromNumberedList } from "@codexly/frontend-core/markdown-list-heading";
export { useStreamingMarkdownTree } from "./use-streaming-markdown-tree.js";

const TreeContext = createContext<
  Readonly<{ tree: MarkdownBlockTree; fast: boolean; parseIncomplete: boolean }>
>({
  tree: null,
  fast: true,
  parseIncomplete: true,
});
// 动画状态独立订阅，避免正文树增量更新穿透 memo，通知所有历史文本叶节点。
const AnimationContext = createContext(false);
const shellBlocks = () => [""];

export function StreamingMarkdown({
  tree,
  fast,
  enabled,
  ...props
}: StreamdownProps & {
  tree: MarkdownBlockTree;
  fast: boolean;
  enabled: boolean;
}) {
  // 静态模式具有最终决定权，避免完成回合残留的运行标记让历史正文再次淡入。
  const animate = props.mode !== "static" && props.isAnimating === true;
  const parseIncomplete = props.mode !== "static" && props.parseIncompleteMarkdown !== false;
  const value = useMemo(() => ({ tree, fast, parseIncomplete }), [tree, fast, parseIncomplete]);
  // 依赖全文的方向检测、动画和标签修复仍由 Streamdown 自己处理，避免改变调用方语义。
  if (
    !enabled ||
    props.dir === "auto" ||
    props.caret !== undefined ||
    props.animated !== undefined ||
    props.allowedTags !== undefined ||
    props.literalTagContent !== undefined ||
    props.remend !== undefined
  ) {
    return (
      <Streamdown
        {...props}
        {...(typeof props.children === "string"
          ? { children: separateBoldTitleFromNumberedList(props.children) }
          : {})}
      />
    );
  }
  return (
    <TreeContext.Provider value={value}>
      <AnimationContext.Provider value={animate}>
        {/* 固定外壳只负责 Streamdown 的插件和控件上下文，正文由共享树独立更新。 */}
        <Streamdown
          {...props}
          mode="streaming"
          BlockComponent={TreeBridge}
          parseMarkdownIntoBlocksFn={shellBlocks}
        >
          {" "}
        </Streamdown>
      </AnimationContext.Provider>
    </TreeContext.Provider>
  );
}

function TreeBridge(props: BlockProps) {
  const { tree, fast, parseIncomplete } = useContext(TreeContext);
  // 固定外壳保持挂载身份，但 static 正文必须关闭不完整语法修复，保留静态 Markdown 语义。
  const options = useMemo(
    () => ({ ...props, shouldParseIncompleteMarkdown: parseIncomplete }),
    [props, parseIncomplete],
  );
  return <BlockTree tree={tree} options={options} offset={0} fast={fast} />;
}

const BlockTree = memo(function BlockTree({
  tree,
  options,
  offset,
  fast,
}: {
  tree: MarkdownBlockTree;
  options: BlockProps;
  offset: number;
  fast: boolean;
}) {
  if (tree === null) return null;
  if (tree.items !== undefined) {
    return tree.items.map((block, index) => (
      <StreamingBlock
        key={offset + index}
        block={block}
        options={options}
        index={offset + index}
        fast={fast}
      />
    ));
  }
  return (
    <>
      <BlockTree tree={tree.left} options={options} offset={offset} fast={fast} />
      <BlockTree
        tree={tree.right}
        options={options}
        offset={offset + tree.capacity / 2}
        fast={fast}
      />
    </>
  );
});

function TextLeaf({ text, allowAnimation }: { text: string; allowAnimation: boolean }) {
  const animate = useContext(AnimationContext);
  const previous = useRef("");
  const shouldAnimate = animate && allowAnimation;
  const prefixLength =
    shouldAnimate && text.startsWith(previous.current) ? previous.current.length : text.length;
  useLayoutEffect(() => {
    previous.current = text;
  }, [text]);
  return (
    <span>
      {text.slice(0, prefixLength)}
      {shouldAnimate && prefixLength < text.length ? (
        // 仅替换本次增量的动画节点：复用同一 span 只会更新文字，不会重启 CSS 动画。
        <span key={prefixLength} data-streaming-text-reveal="">
          {text.slice(prefixLength)}
        </span>
      ) : null}
    </span>
  );
}

const TextTree = memo(function TextTree({
  tree,
  allowAnimation = true,
}: {
  tree: SequenceNode<string> | null;
  allowAnimation?: boolean;
}) {
  if (tree === null) return null;
  if (tree.items !== undefined)
    return tree.items.map((text, index) => (
      <TextLeaf key={index} text={text} allowAnimation={allowAnimation} />
    ));
  return (
    <>
      <TextTree tree={tree.left} allowAnimation={allowAnimation} />
      <TextTree tree={tree.right} allowAnimation={allowAnimation} />
    </>
  );
});

const CodeLines = memo(function CodeLines({
  tree,
  last = true,
  numbers,
}: {
  tree: CodeLineTree;
  last?: boolean;
  numbers: boolean;
}) {
  if (tree === null) return null;
  if (tree.items !== undefined)
    return tree.items.map((line, index) => (
      <span
        data-streaming-code-line=""
        key={index}
        className={
          numbers
            ? "[counter-increment:line] before:mr-4 before:inline-block before:w-8 before:select-none before:text-right before:text-muted-foreground before:content-[counter(line)]"
            : undefined
        }
      >
        {typeof line === "string" ? line : <TextTree tree={line} allowAnimation={false} />}
        {last && index === tree.items.length - 1 ? "" : "\n"}
      </span>
    ));
  return (
    <>
      <CodeLines tree={tree.left} last={last && tree.right === null} numbers={numbers} />
      <CodeLines tree={tree.right} last={last} numbers={numbers} />
    </>
  );
});

function StreamingCode({ block }: { block: Extract<MarkdownBlock, { kind: "code" }> }) {
  const { controls, lineNumbers } = useContext(StreamdownContext);
  const config = typeof controls === "boolean" ? controls : (controls.code ?? true);
  const copy = typeof config === "boolean" ? config : config.copy !== false;
  const download = typeof config === "boolean" ? config : config.download !== false;
  return (
    <CodeBlockContainer language={block.language} isIncomplete>
      <CodeBlockHeader language={block.language} />
      <div>
        <div data-streamdown="code-block-actions">
          {copy ? <CodeBlockCopyButton code={block.code} /> : null}
          {download ? (
            <CodeBlockDownloadButton code={block.code} language={block.language} />
          ) : null}
        </div>
      </div>
      <div data-streamdown="code-block-body" className="overflow-x-auto">
        <pre>
          <code className="[counter-reset:line] whitespace-pre">
            <CodeLines tree={block.lines} numbers={lineNumbers} />
          </code>
        </pre>
      </div>
    </CodeBlockContainer>
  );
}

const StreamingBlock = memo(function StreamingBlock({
  block,
  options,
  index,
  fast,
}: {
  block: MarkdownBlock;
  options: BlockProps;
  index: number;
  fast: boolean;
}) {
  const context = useContext(StreamdownContext);
  const interactive = useMemo(() => ({ ...context, isAnimating: false }), [context]);
  const content =
    block.kind === "deferred" ? (
      <>
        {block.content ? <Block {...options} content={block.content} index={index} /> : null}
        <div data-streaming-markdown-preview="" className="whitespace-pre-wrap break-words">
          <TextTree tree={block.text} />
        </div>
      </>
    ) : fast && block.kind === "text" ? (
      <p dir={options.dir}>
        <TextTree tree={block.text} />
      </p>
    ) : fast && block.kind === "code" ? (
      <StreamingCode block={block} />
    ) : (
      <Block
        {...options}
        content={block.content}
        index={index}
        isIncomplete={block.kind === "code"}
      />
    );
  return <StreamdownContext.Provider value={interactive}>{content}</StreamdownContext.Provider>;
});
