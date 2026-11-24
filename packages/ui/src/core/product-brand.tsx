import {
  DEFAULT_PRODUCT_NAME,
  type ProductNamePreference,
} from "@codexly/frontend-core/product-name-preference";
import { useSyncExternalStore } from "react";

function getDefaultProductName() {
  return DEFAULT_PRODUCT_NAME;
}

export function useProductName(preference: ProductNamePreference) {
  return useSyncExternalStore(preference.subscribe, preference.getSnapshot, getDefaultProductName);
}

export function ProductBrand({ preference }: Readonly<{ preference: ProductNamePreference }>) {
  const name = useProductName(preference);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {name === DEFAULT_PRODUCT_NAME ? (
        <img
          alt={name}
          className="h-7 w-auto max-w-full"
          height="28"
          src="/brand/codexly-logo.svg"
          width="116"
        />
      ) : (
        <>
          <img
            alt=""
            className="size-7 shrink-0"
            height="28"
            src="/brand/codexly-mark.svg"
            width="28"
          />
          {/* 长名称在侧栏内省略，完整名称仍可通过悬停和辅助技术读取。 */}
          <span className="min-w-0 truncate text-body font-semibold" dir="auto" title={name}>
            {name}
          </span>
        </>
      )}
    </div>
  );
}
