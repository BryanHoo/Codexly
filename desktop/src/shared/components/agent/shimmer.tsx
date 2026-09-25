import { memo, useMemo, type CSSProperties, type ElementType, type HTMLAttributes } from "react";

export type ShimmerProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  as?: ElementType;
  children: string;
  duration?: number;
  spread?: number;
};

export const Shimmer = memo(function Shimmer({
  as: Component = "p",
  children,
  className = "",
  duration = 2,
  spread = 2,
  style,
  ...props
}: ShimmerProps) {
  // 扫光参数必须与文案无关，避免流式状态更新时重绘渐变并造成动画跳动。
  const shimmerStyle = useMemo(
    () =>
      ({
        "--ui-shimmer-duration": `${String(duration)}s`,
        "--ui-shimmer-spread": `${String(spread)}em`,
        ...style,
      }) as CSSProperties,
    [duration, spread, style],
  );

  return (
    <Component
      className={`agent-shimmer inline-block ${className}`}
      data-agent-shimmer=""
      style={shimmerStyle}
      {...props}
    >
      {children}
    </Component>
  );
});

Shimmer.displayName = "Shimmer";
