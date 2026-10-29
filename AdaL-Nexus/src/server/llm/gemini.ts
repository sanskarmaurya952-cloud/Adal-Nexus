import { ApiError, GoogleGenAI } from "@google/genai";
import { LLMError, type CompleteOptions, type LLMProvider } from "./types.js";

/** The small slice of the official SDK we use; tests inject a mock of this. */
export interface GeminiModelsApi {
  generateContent(params: {
    model: string;
    contents: string;
    config?: Record<string, unknown>;
  }): Promise<{ text?: string }>;
}

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Injection point for tests. Defaults to the official @google/genai client. */
  models?: GeminiModelsApi;
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly configured = true;
  readonly model: string;
  private models: GeminiModelsApi;
  private defaultTimeoutMs: number;

  constructor(o: GeminiOptions) {
    this.model = o.model;
    this.defaultTimeoutMs = o.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.models = o.models ?? (new GoogleGenAI({ apiKey: o.apiKey }).models as unknown as GeminiModelsApi);
  }

  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);
    // Guarantees we stop waiting even if the SDK ignores the abort signal.
    const aborted = new Promise<never>((_, reject) =>
      ac.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    );
    aborted.catch(() => {});

    try {
      const res = await Promise.race([
        this.models.generateContent({
          model: this.model,
          contents: prompt,
          config: {
            ...(opts.system ? { systemInstruction: opts.system } : {}),
            ...(opts.jsonSchema
              ? { responseMimeType: "application/json", responseJsonSchema: opts.jsonSchema }
              : {}),
            temperature: 0.2,
            abortSignal: ac.signal,
          },
        }),
        aborted,
      ]);
      const text = res?.text;
      if (typeof text !== "string" || !text.trim()) {
        throw new LLMError(
          "invalid_response",
          "Gemini returned an empty response (it may have been blocked or truncated). Try rephrasing the task.",
        );
      }
      return text;
    } catch (err) {
      throw toLLMError(err, timedOut, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Maps any failure to a fixed user-safe message. Raw SDK messages (which could echo request details) are dropped. */
export function toLLMError(err: unknown, timedOut: boolean, timeoutMs = DEFAULT_TIMEOUT_MS): LLMError {
  if (err instanceof LLMError) return err;
  if (timedOut) {
    return new LLMError("timeout", `Gemini did not respond within ${Math.round(timeoutMs / 1000)} s. Try again.`);
  }
  const status = err instanceof ApiError ? err.status : numericStatus(err);
  const raw = err instanceof Error ? err.message : "";
  // Log only the status, never the message or key.
  console.warn(`[gemini] request failed${status ? ` (HTTP ${status})` : ""}`);

  if (status === 429) {
    if (/quota|exhaust|per.?day|billing/i.test(raw)) {
      return new LLMError(
        "quota_exhausted",
        "Gemini quota is exhausted for this key/model (free-tier limits apply). Wait for the quota to reset, set a different GEMINI_MODEL, or enable billing.",
      );
    }
    return new LLMError("rate_limited", "Gemini rate limit reached. Wait a minute and try again.");
  }
  if (status === 401 || status === 403 || (status === 400 && /api.?key/i.test(raw))) {
    return new LLMError(
      "auth",
      "Gemini rejected the API key, or it has no access to this model. Check GEMINI_API_KEY and GEMINI_MODEL in .env.",
    );
  }
  if (status === 404) {
    return new LLMError("api_error", "Gemini model not found. Check GEMINI_MODEL in .env.");
  }
  if (status && status >= 500) {
    return new LLMError("api_error", `Gemini service error (HTTP ${status}). Try again shortly.`);
  }
  return new LLMError("api_error", `Gemini request failed${status ? ` (HTTP ${status})` : ""}.`);
}

function numericStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}
