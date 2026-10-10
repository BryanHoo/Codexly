import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { getMarkdownImagePath } from "@codexly/frontend-core/markdown-image-source";

// 同步 URL 不产生额外请求；原生图片通过延迟函数在挂载后读取，避免渲染阶段执行 IPC。
export type ResolveMessageImage = (path: string) => string | (() => Promise<string>);
const ImageSourceContext = createContext<ResolveMessageImage | undefined>(undefined);

export function MessageImageProvider({
  children,
  resolveImage,
}: {
  children: ReactNode;
  resolveImage?: ResolveMessageImage | undefined;
}) {
  const inherited = useContext(ImageSourceContext);
  return (
    <ImageSourceContext.Provider value={resolveImage ?? inherited}>
      {children}
    </ImageSourceContext.Provider>
  );
}

type MarkdownImageProps = ComponentProps<"img"> & { node?: unknown; unavailableLabel: string };

export function MessageMarkdownImage({ src, node, ...props }: MarkdownImageProps) {
  void node;
  const resolveImage = useContext(ImageSourceContext);
  const path = typeof src === "string" ? getMarkdownImagePath(src) : null;
  const source = useMemo(
    () => (path === null ? src : resolveImage?.(path)),
    [path, resolveImage, src],
  );
  // 路径或任务变化时重建单张图片状态，旧 IPC 返回不能覆盖新任务图片。
  return <ResolvedImage key={typeof src === "string" ? src : "image"} {...props} source={source} />;
}

function ResolvedImage({
  source,
  unavailableLabel,
  alt,
  ...props
}: Omit<MarkdownImageProps, "src" | "node"> & {
  source: ComponentProps<"img">["src"] | (() => Promise<string>);
}) {
  const [loaded, setLoaded] = useState<{ source: typeof source; url?: string }>();
  const [failedUrl, setFailedUrl] = useState<ComponentProps<"img">["src"]>();
  useEffect(() => {
    if (typeof source !== "function") return;
    let active = true;
    // 仅更新仍挂载且属于当前任务的图片；二进制内容经 HTTP/asset 通道读取。
    void source().then(
      (url) => {
        if (active) setLoaded({ source, url });
      },
      () => {
        if (active) setLoaded({ source });
      },
    );
    return () => {
      active = false;
    };
  }, [source]);
  const current = loaded?.source === source ? loaded : undefined;
  const url = typeof source === "function" ? current?.url : source;
  if (!url || failedUrl === url) {
    const loading = typeof source === "function" && current === undefined;
    return (
      <span
        aria-busy={loading}
        role="img"
        aria-label={alt ?? unavailableLabel}
        className="text-muted-foreground"
      >
        {loading ? alt : `${unavailableLabel}${alt ? `：${alt}` : ""}`}
      </span>
    );
  }
  return (
    <img
      {...props}
      alt={alt ?? ""}
      src={url}
      loading="lazy"
      decoding="async"
      onError={(event) => {
        setFailedUrl(url);
        props.onError?.(event);
      }}
    />
  );
}
