import { Copy, ExternalLink, FolderOpen } from "lucide-react";
import { markdownTypographyClassName } from "./markdown-typography.js";
import {
  createContext,
  memo,
  useContext,
  useMemo,
  type ComponentProps,
  type ReactElement,
} from "react";
import {
  Block,
  defaultRemarkPlugins,
  Streamdown,
  StreamdownContext,
  type BlockProps,
  type Components,
} from "streamdown";

import { Button } from "../core/button.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../core/context-menu.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { CodeComments } from "./code-comments.js";
import type { MessageFileReference, MessageFileReferenceOpenMode } from "./message.js";
import {
  IncrementalMessageResponseProcessor,
  RELATIVE_FILE_REFERENCE_PREFIX,
  UNC_FILE_REFERENCE_PREFIX,
} from "./message-response-processing.js";
import { createIncrementalMarkdownBlockParser } from "./incremental-markdown-blocks.js";
import type { TextSnapshot } from "../../lib/append-only-text.js";
import { unparsedStrongRemarkPlugin } from "./markdown-strong-plugin.js";
import { StreamingMarkdown } from "./streaming-markdown.js";
import { openMarkdownLink } from "./markdown-link-navigation.js";

type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
};

type FileReferenceMetadata = Readonly<{
  lineNumber: string | null;
  path: string;
  prompt: boolean;
}>;

interface MarkdownNode {
  children?: MarkdownNode[];
  lang?: string;
  type?: string;
  url?: string;
  value?: string;
}

const MessageFileReferenceContext = createContext<
  ((reference: MessageFileReference, mode?: MessageFileReferenceOpenMode) => void) | null
>(null);

function FileReferenceContextMenu({
  children,
  onOpen,
  reference,
}: Readonly<{
  children: ReactElement;
  onOpen: (reference: MessageFileReference, mode?: MessageFileReferenceOpenMode) => void;
  reference: MessageFileReference;
}>) {
  const { t } = useTranslation("workbench");
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={t("openMenu.targetLabel", { path: reference.path })}>
        <ContextMenuItem
          onSelect={() => {
            // 菜单关闭不等待系统剪贴板，权限失败也不改变当前文件引用状态。
            void navigator.clipboard.writeText(reference.path).catch(() => undefined);
          }}
        >
          <Copy aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.copyAbsolutePath")}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            onOpen(reference, "containing-folder");
          }}
        >
          <FolderOpen aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.openContainingFolder")}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            onOpen(reference, "popup");
          }}
        >
          <ExternalLink aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.openInNewWindow")}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Agent 输出使用“绝对路径:行号”表达文件定位；渲染时拆出行号，避免把路径暴露给用户。
const LOCAL_FILE_REFERENCE_PATTERN =
  /^(?<path>(?:\/|[a-z]:[\\/]|\\\\).+?\.[a-z0-9]+?)(?::(?<line>\d+)(?::\d+)?)?$/i;
const PROMPT_FILE_REFERENCE_PREFIX = "/__codeagent_prompt_reference__/";
const PROMPT_FILE_REFERENCE_PATTERN =
  /(^|\s)@(?<path>[^\s,!?;:，。！？；：、()[\]{}"'`]+)(?=$|\s|[,!?;:，。！？；：、()[\]{}"'`])/gu;
const MESSAGE_RESPONSE_CONTROLS = {
  code: { copy: true, download: false },
  mermaid: false,
  table: false,
} as const;

function decodeMarkdownFileReference(href: string): string {
  try {
    // Markdown href 遵循 URL 编码规则；预览前只解码一次，避免 Client 再次编码百分号。
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function getFileReferenceMetadata(href: string | undefined): FileReferenceMetadata | null {
  if (href === undefined) {
    return null;
  }

  const decodedHref = decodeMarkdownFileReference(href);
  if (decodedHref.startsWith(PROMPT_FILE_REFERENCE_PREFIX)) {
    return {
      lineNumber: null,
      path: decodedHref.slice(PROMPT_FILE_REFERENCE_PREFIX.length),
      prompt: true,
    };
  }

  const match = LOCAL_FILE_REFERENCE_PATTERN.exec(decodedHref);
  const matchedGroups = match?.groups;
  if (matchedGroups === undefined) {
    return null;
  }

  const matchedPath = matchedGroups["path"];
  const filePath = matchedPath?.startsWith(UNC_FILE_REFERENCE_PREFIX)
    ? `//${matchedPath.slice(UNC_FILE_REFERENCE_PREFIX.length)}`
    : matchedPath?.startsWith(RELATIVE_FILE_REFERENCE_PREFIX)
      ? matchedPath.slice(RELATIVE_FILE_REFERENCE_PREFIX.length)
      : matchedPath?.match(/^\/[a-z]:[\\/]/i)
        ? matchedPath.slice(1)
        : matchedPath;
  if (filePath === undefined) {
    return null;
  }

  return {
    lineNumber: matchedGroups["line"] ?? null,
    path: filePath,
    prompt: false,
  };
}

function splitPromptFileReferenceText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(PROMPT_FILE_REFERENCE_PATTERN)) {
    const path = match.groups?.["path"];
    if (path === undefined) {
      continue;
    }
    const referenceStart = match.index + (match[1]?.length ?? 0);
    if (referenceStart > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, referenceStart) });
    }
    nodes.push({
      children: [{ type: "text", value: path.split("/").at(-1) ?? path }],
      type: "link",
      url: `${PROMPT_FILE_REFERENCE_PREFIX}${encodeURIComponent(path)}`,
    });
    cursor = referenceStart + path.length + 1;
  }
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes;
}

function promptFileReferenceRemarkPlugin() {
  return (tree: MarkdownNode) => {
    // 只改写 Markdown 普通文本，已有链接和行内/块级代码由 AST 边界自然隔离。
    const transform = (node: MarkdownNode) => {
      if (node.type === "link" || node.type === "linkReference" || node.children === undefined) {
        return;
      }
      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && child.value !== undefined) {
          return splitPromptFileReferenceText(child.value);
        }
        transform(child);
        return child;
      });
    };
    transform(tree);
  };
}

function rawMarkupRemarkPlugin() {
  return (tree: MarkdownNode) => {
    const transform = (node: MarkdownNode, parentType?: string) => {
      if (node.type === "html") {
        // Agent 输出不执行原始标记；将 XML/HTML 源码转成可复制且安全转义的代码节点。
        node.type = parentType === "paragraph" ? "inlineCode" : "code";
        if (node.type === "code") {
          node.lang = "xml";
        }
        return;
      }

      for (const child of node.children ?? []) {
        transform(child, node.type);
      }
    };

    transform(tree);
  };
}

function MarkdownLink({
  children,
  className = "",
  href,
  node,
  onClick,
  ...props
}: MarkdownLinkProps) {
  // Streamdown 注入的语法树节点不能透传给原生元素。
  void node;
  const fileReference = getFileReferenceMetadata(href);
  const onOpenFileReference = useContext(MessageFileReferenceContext);

  if (fileReference !== null) {
    if (fileReference.prompt) {
      const classNames = `text-inherit ${className}`;
      const content = <>@{fileReference.path}</>;

      if (onOpenFileReference !== null) {
        const reference = { lineNumber: null, path: fileReference.path };
        return (
          <FileReferenceContextMenu onOpen={onOpenFileReference} reference={reference}>
            <Button
              variant="embedded"
              aria-label={`@${fileReference.path}`}
              className={`${classNames} cursor-pointer hover:underline`}
              data-prompt-file-reference={fileReference.path}
              onClick={() => {
                onOpenFileReference(reference);
              }}
              size="embedded"
              title={fileReference.path}
              type="button"
            >
              {content}
            </Button>
          </FileReferenceContextMenu>
        );
      }

      return (
        <span
          className={classNames}
          data-prompt-file-reference={fileReference.path}
          title={fileReference.path}
        >
          {content}
        </span>
      );
    }

    const content = (
      <>
        <span>{children}</span>
        {fileReference.lineNumber === null ? null : (
          <span className="markdown-file-reference__line">
            {`(line ${fileReference.lineNumber})`}
          </span>
        )}
      </>
    );

    if (onOpenFileReference !== null) {
      const reference = {
        lineNumber: fileReference.lineNumber === null ? null : Number(fileReference.lineNumber),
        path: fileReference.path,
      };
      return (
        <FileReferenceContextMenu onOpen={onOpenFileReference} reference={reference}>
          <Button
            variant="ghost"
            className={`markdown-file-reference cursor-pointer text-brand underline decoration-transparent underline-offset-2 transition-colors hover:text-brand-strong hover:decoration-current ${className}`}
            data-file-reference="true"
            onClick={() => {
              onOpenFileReference(reference);
            }}
            title={fileReference.path}
            type="button"
          >
            {content}
          </Button>
        </FileReferenceContextMenu>
      );
    }

    return (
      <span
        className={`markdown-file-reference text-brand ${className}`}
        data-file-reference="true"
        title={fileReference.path}
      >
        {content}
      </span>
    );
  }

  return (
    <a
      className={`font-medium text-brand underline decoration-current/35 underline-offset-2 transition-colors hover:text-brand-strong ${className}`}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          openMarkdownLink(event, href);
        }
      }}
      rel="noopener noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  );
}

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  textSource?: TextSnapshot;
  onOpenFileReference?: (
    reference: MessageFileReference,
    mode?: MessageFileReferenceOpenMode,
  ) => void;
  promptFileReferences?: boolean;
};

function InteractiveMessageBlock(props: BlockProps) {
  const streamdownContext = useContext(StreamdownContext);
  const interactiveContext = useMemo(
    () => ({ ...streamdownContext, isAnimating: false }),
    [streamdownContext],
  );

  // 文本仍由外层 Streamdown 执行动画，块内控件不能因此失去点击能力。
  return (
    <StreamdownContext.Provider value={interactiveContext}>
      <Block {...props} />
    </StreamdownContext.Provider>
  );
}

function MessageResponseContent({
  children,
  className = "",
  components,
  onOpenFileReference,
  parseMarkdownIntoBlocksFn,
  promptFileReferences = false,
  remarkPlugins,
  textSource,
  ...props
}: MessageResponseProps) {
  const responseProcessor = useMemo(() => new IncrementalMessageResponseProcessor(), []);
  const incrementalBlockParser = useMemo(() => createIncrementalMarkdownBlockParser(), []);
  const parsedResponse = responseProcessor.process(textSource ?? children ?? "");
  const streaming = props.mode !== "static" && props.isAnimating !== false;
  const enabled = textSource !== undefined && props.mode !== "static" && parseMarkdownIntoBlocksFn === undefined;
  const blockTree = useMemo(
    () => enabled ? incrementalBlockParser(parsedResponse, streaming) : null,
    [enabled, incrementalBlockParser, parsedResponse, streaming],
  );
  const markdownComponents: Components = useMemo(
    () => ({ ...components, a: MarkdownLink }),
    [components],
  );
  const resolvedRemarkPlugins = useMemo(
    () => [
      // Streamdown 收到自定义插件后不再注入默认 GFM；必须显式保留表格等标准扩展。
      ...Object.values(defaultRemarkPlugins),
      unparsedStrongRemarkPlugin,
      rawMarkupRemarkPlugin,
      ...(promptFileReferences ? [promptFileReferenceRemarkPlugin] : []),
      ...(remarkPlugins ?? []),
    ],
    [promptFileReferences, remarkPlugins],
  );

  return (
    <MessageFileReferenceContext.Provider value={onOpenFileReference ?? null}>
      <StreamingMarkdown
        enabled={enabled}
        tree={blockTree}
        fast={streaming && components === undefined && remarkPlugins === undefined && props.rehypePlugins === undefined && props.plugins === undefined && !promptFileReferences}
        className={`size-full ${markdownTypographyClassName} ${className}`}
        controls={MESSAGE_RESPONSE_CONTROLS}
        {...props}
        BlockComponent={InteractiveMessageBlock}
        components={markdownComponents}
        {...(parseMarkdownIntoBlocksFn === undefined ? {} : { parseMarkdownIntoBlocksFn })}
        remarkPlugins={resolvedRemarkPlugins}
      >
        {parsedResponse.markdown}
      </StreamingMarkdown>
      <CodeComments comments={parsedResponse.comments} />
    </MessageFileReferenceContext.Provider>
  );
}

export const MessageResponse = memo(
  MessageResponseContent,
  (previousProps, nextProps) =>
    previousProps.textSource === nextProps.textSource &&
    previousProps.children === nextProps.children &&
    previousProps.isAnimating === nextProps.isAnimating &&
    previousProps.mode === nextProps.mode &&
    previousProps.onOpenFileReference === nextProps.onOpenFileReference &&
    previousProps.promptFileReferences === nextProps.promptFileReferences,
);

MessageResponse.displayName = "MessageResponse";

export default MessageResponse;
