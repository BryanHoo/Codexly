import { createContext, memo, useContext, useMemo } from "react";
import {
  Block, CodeBlockContainer, CodeBlockCopyButton, CodeBlockDownloadButton, CodeBlockHeader,
  Streamdown, StreamdownContext, type BlockProps, type StreamdownProps,
} from "streamdown";
import type { SequenceNode } from "../../lib/persistent-sequence.js";
import type { MarkdownBlockTree } from "./incremental-markdown-blocks.js";
import type { CodeLineTree, MarkdownBlock } from "./streaming-markdown-block.js";

const TreeContext = createContext<Readonly<{ tree: MarkdownBlockTree; fast: boolean }>>({ tree: null, fast: true });
const shellBlocks = () => [""];

export function StreamingMarkdown({ tree, fast, enabled, ...props }: StreamdownProps & {
  tree: MarkdownBlockTree; fast: boolean; enabled: boolean;
}) {
  const value = useMemo(() => ({ tree, fast }), [tree, fast]);
  // 依赖全文的方向检测、动画和标签修复仍由 Streamdown 自己处理，避免改变调用方语义。
  if (!enabled || props.dir === "auto" || props.caret !== undefined || props.animated !== undefined ||
    props.allowedTags !== undefined || props.literalTagContent !== undefined || props.remend !== undefined) {
    return <Streamdown {...props} />;
  }
  return (
    <TreeContext.Provider value={value}>
      {/* 固定外壳只负责 Streamdown 的插件和控件上下文，正文由共享树独立更新。 */}
      <Streamdown {...props} mode="streaming" BlockComponent={TreeBridge} parseMarkdownIntoBlocksFn={shellBlocks}>
        {" "}
      </Streamdown>
    </TreeContext.Provider>
  );
}

function TreeBridge(props: BlockProps) {
  const { tree, fast } = useContext(TreeContext);
  return <BlockTree tree={tree} options={props} offset={0} fast={fast} />;
}

const BlockTree = memo(function BlockTree({ tree, options, offset, fast }: {
  tree: MarkdownBlockTree; options: BlockProps; offset: number; fast: boolean;
}) {
  if (tree === null) return null;
  if (tree.items !== undefined) {
    return tree.items.map((block, index) => (
      <StreamingBlock key={offset + index} block={block} options={options} index={offset + index} fast={fast} />
    ));
  }
  return <>
    <BlockTree tree={tree.left} options={options} offset={offset} fast={fast} />
    <BlockTree tree={tree.right} options={options} offset={offset + tree.capacity / 2} fast={fast} />
  </>;
});

const TextTree = memo(function TextTree({ tree }: { tree: SequenceNode<string> | null }) {
  if (tree === null) return null;
  if (tree.items !== undefined) return tree.items.map((text, index) => <span key={index}>{text}</span>);
  return <><TextTree tree={tree.left} /><TextTree tree={tree.right} /></>;
});

const CodeLines = memo(function CodeLines({ tree, last = true, numbers }: {
  tree: CodeLineTree; last?: boolean; numbers: boolean;
}) {
  if (tree === null) return null;
  if (tree.items !== undefined) return tree.items.map((line, index) => (
    <span
      data-streaming-code-line=""
      key={index}
      className={numbers ? "[counter-increment:line] before:mr-4 before:inline-block before:w-8 before:select-none before:text-right before:text-muted-foreground before:content-[counter(line)]" : undefined}
    >{typeof line === "string" ? line : <TextTree tree={line} />}{last && index === tree.items.length - 1 ? "" : "\n"}</span>
  ));
  return <>
    <CodeLines tree={tree.left} last={last && tree.right === null} numbers={numbers} />
    <CodeLines tree={tree.right} last={last} numbers={numbers} />
  </>;
});

function StreamingCode({ block }: { block: Extract<MarkdownBlock, { kind: "code" }> }) {
  const { controls, lineNumbers } = useContext(StreamdownContext);
  const config = typeof controls === "boolean" ? controls : controls.code ?? true;
  const copy = typeof config === "boolean" ? config : config.copy !== false;
  const download = typeof config === "boolean" ? config : config.download !== false;
  return (
    <CodeBlockContainer language={block.language} isIncomplete>
      <CodeBlockHeader language={block.language} />
      <div><div data-streamdown="code-block-actions">
        {copy ? <CodeBlockCopyButton code={block.code} /> : null}
        {download ? <CodeBlockDownloadButton code={block.code} language={block.language} /> : null}
      </div></div>
      <div data-streamdown="code-block-body" className="overflow-x-auto">
        <pre><code className="[counter-reset:line] whitespace-pre"><CodeLines tree={block.lines} numbers={lineNumbers} /></code></pre>
      </div>
    </CodeBlockContainer>
  );
}

const StreamingBlock = memo(function StreamingBlock({ block, options, index, fast }: {
  block: MarkdownBlock; options: BlockProps; index: number; fast: boolean;
}) {
  const context = useContext(StreamdownContext);
  const interactive = useMemo(() => ({ ...context, isAnimating: false }), [context]);
  const content = block.kind === "deferred"
    ? <>
        {block.content ? <Block {...options} content={block.content} index={index} /> : null}
        <div data-streaming-markdown-preview="" className="whitespace-pre-wrap break-words"><TextTree tree={block.text} /></div>
      </>
    : fast && block.kind === "text"
    ? <p dir={options.dir}><TextTree tree={block.text} /></p>
    : fast && block.kind === "code"
      ? <StreamingCode block={block} />
      : <Block {...options} content={block.content} index={index} isIncomplete={block.kind === "code"} />;
  return <StreamdownContext.Provider value={interactive}>{content}</StreamdownContext.Provider>;
});
