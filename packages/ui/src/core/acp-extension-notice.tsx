import { LoadingSkeleton } from "./loading-skeleton.js";

/** 旧扩展地址仍可打开，所有智能体扩展由该智能体自身管理。 */
export function AcpExtensionNotice({
  pending,
  language,
  title,
}: Readonly<{ pending: boolean; language: string; title: string }>) {
  const chinese = language.startsWith("zh");
  if (pending) return <LoadingSkeleton label={chinese ? "正在加载…" : "Loading…"} />;
  return (
    <section className="space-y-4" aria-label={title}>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-body-small">
        {chinese
          ? "请使用智能体自身提供的设置管理 Skills、MCP 和插件。"
          : "Use the agent’s own settings to manage skills, MCP servers and plugins."}
      </p>
    </section>
  );
}
