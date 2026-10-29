import type { ApprovedDraftRecord } from "./types.js";

export class ServiceUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = "SERVICE_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

export interface MockPublishResult {
  mockPermalink: string;
  simulatedPostId: string;
  simulatedAt: string;
}

export interface PublishParams {
  draft: ApprovedDraftRecord;
  attemptId: string;
  abortSignal?: AbortSignal;
}

export interface InstagramPublishingProvider {
  readonly name: string;
  publish(params: PublishParams): Promise<MockPublishResult>;
}

export class MockInstagramPublishingProvider implements InstagramPublishingProvider {
  readonly name = "mock";
  private readonly configuredProvider: string;
  private readonly simulatedDelayMs: number;

  constructor(options?: { configuredProvider?: string; simulatedDelayMs?: number }) {
    this.configuredProvider = (options?.configuredProvider ?? process.env.SOCIAL_PUBLISHING_PROVIDER ?? "").trim().toLowerCase();
    this.simulatedDelayMs = options?.simulatedDelayMs ?? 1000;
  }

  /**
   * Safe mock publish implementation.
   * STRICT SAFEGUARD: ZERO outbound network requests are made.
   * Simulates processing latency via local timer only.
   */
  async publish({ draft, attemptId, abortSignal }: PublishParams): Promise<MockPublishResult> {
    // Fail-closed guard: Must be explicitly enabled with "mock"
    if (this.configuredProvider !== "mock") {
      throw new ServiceUnavailableError(
        "Social publishing provider is unconfigured or not in mock mode. Live Instagram posting is not supported for Personal accounts."
      );
    }

    if (!draft || !draft.id) {
      throw new Error("Invalid draft provided to mock publishing provider");
    }

    // Check if already aborted
    if (abortSignal?.aborted) {
      throw new Error("Mock publishing attempt was cancelled before execution");
    }

    // Simulated processing latency (pure local timer, no network I/O)
    if (this.simulatedDelayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve();
        }, this.simulatedDelayMs);

        if (abortSignal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("Mock publishing attempt was aborted"));
          };
          abortSignal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }

    const shortId = attemptId.replace(/^mock_att_/, "").slice(0, 8);
    const simulatedAt = new Date().toISOString();

    // STRICT SAFEGUARD: internal mock:// URI scheme only. Never a real https://instagram.com link.
    return {
      mockPermalink: `mock://instagram/p/mock-${shortId}`,
      simulatedPostId: `mock_post_${shortId}`,
      simulatedAt,
    };
  }
}
