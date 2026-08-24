import { RouterProvider } from "@tanstack/react-router";

import { router } from "./app/router.js";

export function App() {
  // App 只持有顶层导航，具体页面和功能状态由路由模块负责。
  return <RouterProvider router={router} />;
}
