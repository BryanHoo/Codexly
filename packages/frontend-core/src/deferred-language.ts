type ResourceNamespaces = Record<string, Record<string, unknown>>;

export function createDeferredLanguageBackend(
  ensure: (language: "en" | "zh-CN") => Promise<void>,
  readResources: (language: string, namespace: string) => unknown,
) {
  return {
    type: "backend" as const,
    read(
      language: string,
      namespace: string,
      callback: (error: Error | null, values: Record<string, unknown>) => void,
    ) {
      // 接入 i18next 的异步生命周期，业务代码直接切换语言也会等待文案加载。
      void ensure(language === "en" ? "en" : "zh-CN").then(
        () => {
          const values = readResources(language, namespace);
          callback(
            null,
            typeof values === "object" && values !== null && !Array.isArray(values)
              ? (values as Record<string, unknown>)
              : {},
          );
        },
        (error: unknown) => {
          callback(error instanceof Error ? error : new Error(String(error)), {});
        },
      );
    },
  };
}

export function createDeferredLanguageLoader(
  loadEnglish: () => Promise<ResourceNamespaces>,
  register: (language: string, namespace: string, resources: Record<string, unknown>) => void,
) {
  let loaded = false;
  let pending: Promise<void> | undefined;
  return async (language: "en" | "zh-CN"): Promise<void> => {
    // 中文回退资源随入口提供；仅选择英语时下载英语包，两端共用加载与重试规则。
    if (language !== "en" || loaded) return;
    pending ??= loadEnglish()
      .then((resources) => {
        for (const [namespace, values] of Object.entries(resources))
          register("en", namespace, values);
        loaded = true;
      })
      .finally(() => {
        pending = undefined;
      });
    await pending;
  };
}
