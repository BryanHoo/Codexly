import { isWindowsHostPath, joinHostPath } from "./host-path.js";

export type ProjectDocumentReference = Readonly<{ path: string; lineNumber: number | null }>;

/** 以文件所在目录解析链接，完全独立于浏览器 URL 和浏览器操作系统。 */
export function resolveProjectDocumentLink(
  href: string,
  sourcePath: string,
): ProjectDocumentReference | null {
  if (href.startsWith("/__codexly_document__/")) {
    try {
      href = decodeURIComponent(href.slice("/__codexly_document__/".length));
    } catch {
      return null;
    }
  }
  if (!href || href.startsWith("#") || href.startsWith("//")) return null;
  if (/^[a-z][a-z\d+.-]*:/iu.test(href) && !/^(?:file:|sandbox:|[a-z]:[\\/])/iu.test(href))
    return null;
  const line = /#L(\d+)(?:-L?\d+)?$/iu.exec(href)?.[1];
  let path = href.split(/[?#]/u)[0] ?? "";
  try {
    path = decodeURIComponent(path);
  } catch {
    /* 保留损坏编码，由宿主文件读取边界校验。 */
  }
  path = path.replace(/^\/(?:__codexly|__codeagent)_relative__\//u, "");
  path = path.replace(/^\/(?:__codexly|__codeagent)_unc__\//u, "//");
  if (/^file:\/\//iu.test(path)) {
    path = path.replace(/^file:\/\/(?:localhost(?=\/))?/iu, "");
    if (path && !path.startsWith("/")) path = `//${path}`;
  }
  path = path.replace(/^sandbox:/iu, "").replace(/^\/([a-z]:[\\/])/iu, "$1");
  if (!path) return null;
  const windows = isWindowsHostPath(sourcePath) || isWindowsHostPath(path);
  const source = windows ? sourcePath.replaceAll("\\", "/") : sourcePath;
  if (windows) path = path.replaceAll("\\", "/");
  if (!path.startsWith("/") && !/^[a-z]:\//iu.test(path)) {
    path = joinHostPath(source.slice(0, source.lastIndexOf("/") + 1) || ".", path);
  }
  // 只消解路径段，不折叠大小写或 Unicode；UNC 的服务器与共享目录不能被 .. 越过。
  const prefix = path.startsWith("//") ? "//" : path.startsWith("/") ? "/" : "";
  const parts: string[] = [];
  const floor = prefix === "//" ? 2 : /^[a-z]:\//iu.test(path) ? 1 : 0;
  for (const part of path.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > floor && parts.at(-1) !== "..") parts.pop();
      else if (!prefix && floor === 0) parts.push(part);
    } else parts.push(part);
  }
  return { path: prefix + parts.join("/"), lineNumber: line === undefined ? null : Number(line) };
}

interface LinkNode {
  type?: string;
  url?: string;
  children?: LinkNode[];
}
/** 在 URL 清洗前封装文件路径，避免 ../ 被按网页目录提前消解，file: 被当作浏览器协议丢弃。 */
export function projectDocumentLinkRemarkPlugin() {
  return (tree: LinkNode) => {
    const visit = (node: LinkNode) => {
      if (node.type === "link" && node.url && !node.url.startsWith("#")) {
        const href = node.url;
        if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href) || /^(?:file:|sandbox:)/iu.test(href)) {
          node.url = "/__codexly_document__/" + encodeURIComponent(href);
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
