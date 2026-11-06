import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import {
  resolveProjectDocumentLink,
  type ProjectDocumentReference,
} from "@codexly/frontend-core/project-document-link";

// 仅文件预览提供目录上下文，聊天里的文件引用保持原有项目根目录语义。
export const ProjectDocumentLinksContext = createContext<{
  sourcePath: string;
  openFile: (reference: ProjectDocumentReference) => void;
} | null>(null);

export function useProjectDocumentLink(
  href: string | undefined,
  children: ReactNode,
  props: ComponentProps<"a">,
) {
  const context = useContext(ProjectDocumentLinksContext);
  if (!context || !href) return null;
  const reference = resolveProjectDocumentLink(href, context.sourcePath);
  if (!reference && !href.startsWith("#")) return null;
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (reference) context.openFile(reference);
        else {
          // 页内定位限制在当前文件面板，避免命中另一分屏的同名标题。
          let id = href.slice(1);
          try {
            id = decodeURIComponent(id);
          } catch {
            /* 损坏编码按原文匹配。 */
          }
          const scope = event.currentTarget.closest(".file-markdown");
          const target = Array.from(scope?.querySelectorAll("[id]") ?? []).find(
            (node) => node.id === id,
          );
          target?.scrollIntoView({ block: "start" });
        }
      }}
    >
      {children}
    </a>
  );
}
