export type LLMErrorCode =
  | "not_configured"
  | "rate_limited"
  | "quota_exhausted"
  | "timeout"
  | "auth"
  | "api_error"
  | "invalid_response";

/** Errors carry a fixed, user-safe message. Raw provider messages are never exposed. */
export class LLMError extends Error {
  constructor(
    readonly code: LLMErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export interface CompleteOptions {
  system?: string;
  /** When set, the provider must request JSON output conforming to this JSON Schema. */
  jsonSchema?: unknown;
  timeoutMs?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model?: string;
  readonly configured: boolean;
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}
