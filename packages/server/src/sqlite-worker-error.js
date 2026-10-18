export function serializeError(error) {
  return {
    code:
      error !== null && typeof error === "object" && typeof error.code === "string"
        ? error.code
        : undefined,
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error",
  };
}
