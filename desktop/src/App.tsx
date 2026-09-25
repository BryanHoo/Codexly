import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";

import { router } from "./app/router.js";
import { installMainWindowNavigation } from "./app/main-window-navigation.js";

export function App() {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void installMainWindowNavigation((href) => router.navigate({ href }))
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // App 只持有顶层导航，具体页面和功能状态由路由模块负责。
  return <RouterProvider router={router} />;
}
