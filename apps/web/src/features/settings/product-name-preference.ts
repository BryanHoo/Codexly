import { createProductNamePreference } from "@codexly/frontend-core/product-name-preference";

export const productNamePreference = createProductNamePreference(
  {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value);
    },
  },
  "codexly:product-name:v1",
);
