export type JsonRecord = Record<string, unknown>;

export class RuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 500, message = code) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.status = status;
  }
}

export function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
