import { normalizeTheme, type ThemeRegistrationAny } from "shiki/core";

type ThemeLoader = () => Promise<ThemeRegistrationAny | { default: ThemeRegistrationAny }>;

type CreateThemeOptions = Readonly<{
  collection?: string;
  colorScheme?: "dark" | "light";
  displayName?: string;
  load: ThemeLoader;
  name: string;
}>;

type ThemeDescriptor = ReturnType<typeof createTheme>;

type ThemeResolver = Readonly<{
  registerThemeIfAbsent: (name: string, load: ThemeDescriptor["load"]) => unknown;
}>;

function unwrapDefault(
  theme: ThemeRegistrationAny | { default: ThemeRegistrationAny },
): ThemeRegistrationAny {
  return "default" in theme ? theme.default : theme;
}

export function createTheme(options: CreateThemeOptions) {
  return {
    ...options,
    load: async () => normalizeTheme(unwrapDefault(await options.load())),
  };
}

function createThemeCollection(descriptors: readonly ThemeDescriptor[]) {
  const themesByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));

  return {
    getTheme: (name: string) => themesByName.get(name),
    getThemeNames: () => descriptors.map((descriptor) => descriptor.name),
    getThemes: () => descriptors,
    hasTheme: (name: string) => themesByName.has(name),
    orderBy: (compare: (left: ThemeDescriptor, right: ThemeDescriptor) => number) =>
      createThemeCollection([...descriptors].sort(compare)),
    pick: (names: readonly string[]) =>
      createThemeCollection(
        names.map((name) => {
          const descriptor = themesByName.get(name);
          if (descriptor === undefined) {
            throw new Error(`Theme collection does not contain theme "${name}"`);
          }
          return descriptor;
        }),
      ),
    registerInto: (resolver: ThemeResolver) => {
      for (const descriptor of descriptors) {
        resolver.registerThemeIfAbsent(descriptor.name, descriptor.load);
      }
    },
  };
}

export const pierreThemes = createThemeCollection([]);

export const shikiThemes = createThemeCollection([
  createTheme({
    collection: "shiki",
    colorScheme: "light",
    load: () => import("shiki/themes/github-light.mjs"),
    name: "github-light",
  }),
  createTheme({
    collection: "shiki",
    colorScheme: "dark",
    load: () => import("shiki/themes/github-dark.mjs"),
    name: "github-dark",
  }),
]);

export const themes = shikiThemes;
