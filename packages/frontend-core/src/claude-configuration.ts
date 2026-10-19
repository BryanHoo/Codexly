export interface ConnectionDraft {
  baseUrl: string;
  apiKey: string;
}
export const validEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/\/(messages|chat\/completions)\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
};
