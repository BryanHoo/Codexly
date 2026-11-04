import type { StreamdownProps } from "streamdown";

type DiagramPlugin = NonNullable<NonNullable<StreamdownProps["plugins"]>["mermaid"]>;

export function createDeferredMermaidPlugin(
  load: () => Promise<DiagramPlugin> = async () => (await import("@streamdown/mermaid")).mermaid,
): DiagramPlugin {
  let pending: Promise<DiagramPlugin> | undefined;
  const getPlugin = () => {
    // 只有真正渲染图表才下载 Mermaid；多个消息共用在途加载，失败后允许用户重试。
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
  return {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid(config) {
      // 每个图表保留自己的配置，异步下载不能使其他消息的主题覆盖当前图表。
      let currentConfig = config;
      return {
        initialize(nextConfig) {
          currentConfig = nextConfig;
        },
        async render(id, source) {
          return (await getPlugin()).getMermaid(currentConfig).render(id, source);
        },
      };
    },
  };
}

export const deferredMermaid = createDeferredMermaidPlugin();
