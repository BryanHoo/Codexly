import type { ReactNode } from "react";
import { LoadingSkeleton } from "./loading-skeleton.js";

/** 在挂载旧查询之前区分运行时；能力未就绪不能默认回退并启动厂商接口。 */
export function RuntimeSettingsBoundary({
  runtime,
  language,
  title,
  feature,
  children,
}: Readonly<{
  runtime: "pending" | "legacy" | "acp";
  language: string;
  title: string;
  feature: "personalization" | "extensions";
  children: ReactNode;
}>) {
  const chinese = language.startsWith("zh");
  if (runtime === "pending") return <LoadingSkeleton label={chinese ? "正在加载…" : "Loading…"} />;
  if (runtime === "legacy") return children;
  return (
    <section className="space-y-4" aria-label={title}>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-body-small text-muted-foreground">
        {chinese
          ? "当前连接暂不支持在此管理这些设置。"
          : "This connection does not support managing these settings here."}
      </p>
      <p className="text-body-small">
        {feature === "personalization"
          ? chinese
            ? "请使用智能体自身提供的设置管理全局指令和记忆。"
            : "Use the agent’s own settings to manage global instructions and memory."
          : chinese
            ? "请使用智能体自身提供的设置管理 Skills、MCP 和插件。"
            : "Use the agent’s own settings to manage skills, MCP servers and plugins."}
      </p>
    </section>
  );
}
