export function deserializeWorkerError(error: Readonly<{ message: string; name: string }>): Error {
  const result = new Error(error.message);
  result.name = error.name;
  return result;
}
