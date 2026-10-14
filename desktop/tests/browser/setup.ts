import { beforeEach } from "vitest";

// 英语资源按需加载；测试入口必须等初始化完成，避免组件因翻译未就绪而暂停挂载。
// 在计时和布局断言开始前统一等待，既保留真实加载逻辑，也不把加载耗时计入渲染性能。
beforeEach(async () => {
  // 测试模块先注册原生存储 mock，再动态读取 i18n，避免 setupFiles 提前缓存真实依赖。
  // Web 和桌面组件可能在模块加载时再次初始化同一实例，必须在用例开始前检查实际状态。
  const { i18n } = await import("../../src/i18n/i18n.js");
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      const onInitialized = () => {
        i18n.off("initialized", onInitialized);
        resolve();
      };
      i18n.on("initialized", onInitialized);
    });
  }
});
