// 兼容旧导出路径；实际侧边浮层统一由 Drawer 实现，方向由 Root.swipeDirection 控制。
export {
  Drawer as Sheet,
  DrawerClose as SheetClose,
  DrawerContent as SheetContent,
  DrawerDescription as SheetDescription,
  DrawerFooter as SheetFooter,
  DrawerHeader as SheetHeader,
  DrawerTitle as SheetTitle,
  DrawerTrigger as SheetTrigger,
} from "./drawer.js";
