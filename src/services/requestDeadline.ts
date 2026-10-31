/** Bound the complete request, including a response body that never finishes. */
export async function requestWithDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('REQUEST_TIMEOUT'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => request(controller.signal)),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
