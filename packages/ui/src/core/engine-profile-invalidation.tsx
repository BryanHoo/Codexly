import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** 工作区级监听在聊天卸载后仍保留，设置页保存也能撤销旧的引擎能力缓存。 */
export function useEngineProfileInvalidation(): void {
  const client = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      // 同时撤销旧请求的缓存写入资格，避免设置保存前发出的响应重新成为新草稿的默认值。
      client.removeQueries({ queryKey: ["engine-profile"] });
    };
    window.addEventListener("codexly:engine-settings-changed", refresh);
    return () => {
      window.removeEventListener("codexly:engine-settings-changed", refresh);
    };
  }, [client]);
}
