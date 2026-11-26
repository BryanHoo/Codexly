import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

export function createLazyMessageResponse<
  Props extends { children?: ReactNode; className?: string },
>(loadMessageResponse: () => Promise<{ default: ComponentType<Props> }>) {
  // 每个宿主在模块初始化时绑定一次懒加载入口，正文仍由各端的渲染器处理。
  const DeferredMessageResponse = lazy(loadMessageResponse);

  return function LazyMessageResponse(props: Props) {
    const { children = "", className = "" } = props;
    // 保持与 Streamdown 相同的首层段落结构，避免异步升级前发生行内布局跳变。
    const fallback = (
      <div className={`size-full whitespace-pre-wrap break-words ${className}`}>
        <p>{children}</p>
      </div>
    );

    return (
      <Suspense fallback={fallback}>
        <DeferredMessageResponse {...props} className={className}>
          {children}
        </DeferredMessageResponse>
      </Suspense>
    );
  };
}
