import { i18n } from "../../src/i18n/i18n.js";

// 英语资源按需加载；测试入口必须等初始化完成，避免组件因翻译未就绪而暂停挂载。
// 在计时和布局断言开始前统一等待，既保留真实加载逻辑，也不把加载耗时计入渲染性能。
if (!i18n.isInitialized) {
  await new Promise<void>((resolve) => {
    const onInitialized = () => {
      i18n.off("initialized", onInitialized);
      resolve();
    };
    i18n.on("initialized", onInitialized);
  });
}
