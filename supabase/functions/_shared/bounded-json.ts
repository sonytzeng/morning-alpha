export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('REQUEST_TOO_LARGE');
    this.name = 'RequestBodyTooLargeError';
  }
}

export function contentLengthExceedsLimit(value: string | null, maxBytes: number): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed > maxBytes;
}

export async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel('REQUEST_TOO_LARGE');
        } catch {
          // Best-effort cancellation once the hard response limit is crossed.
        }
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  return decodeUtf8(await readBoundedBytes(body, maxBytes));
}

export async function readBoundedJsonResponse(response: Response, maxBytes: number): Promise<unknown> {
  const responseText = await readBoundedText(response.body, maxBytes);
  if (!responseText) throw new Error('UPSTREAM_RESPONSE_INVALID_JSON');
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    throw new Error('UPSTREAM_RESPONSE_INVALID_JSON');
  }
}
