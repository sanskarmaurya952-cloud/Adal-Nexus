import { Router } from "express";
import type { LLMProvider } from "../llm/types.js";
import { CaptionService, CaptionServiceError } from "./captionService.js";
import { IntegrationService } from "./integrationService.js";
import { MultiPlatformCaptionService } from "./multiPlatformCaptionService.js";
import { validateUserImage } from "./imageValidator.js";
import { SocialPublishingService } from "./socialPublishingService.js";

export function createSocialRouter(
  llm: LLMProvider,
  integrationService: IntegrationService = new IntegrationService()
): Router {
  const router = Router();
  const captionService = new CaptionService(llm);
  const multiCaptionService = new MultiPlatformCaptionService(llm);
  const publishingService = new SocialPublishingService(integrationService.store, integrationService.mockProvider);

  // Returns live connection statuses for Google Drive and Instagram
  router.get("/status", (_req, res) => {
    res.json(integrationService.getStatus());
  });

  // Generates structured captions, hashtags, and alternatives using Gemini
  router.post("/generate-caption", async (req, res) => {
    try {
      const response = await captionService.generate(req.body);
      res.json(response);
    } catch (err) {
      if (err instanceof CaptionServiceError) {
        const statusMap: Record<CaptionServiceError["code"], number> = {
          invalid_input: 400,
          not_configured: 503,
          provider_error: 502,
          invalid_response: 422,
        };
        res.status(statusMap[err.code] || 500).json({ error: err.message, code: err.code });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : "Internal error", code: "internal_error" });
      }
    }
  });

  // Explicit approval step for draft review and ownership confirmation
  router.post("/approve-draft", async (req, res) => {
    try {
      const approved = await integrationService.approveDraft(req.body);
      res.status(201).json(approved);
    } catch (err: any) {
      const statusCode = err?.statusCode || 400;
      res.status(statusCode).json({
        error: err instanceof Error ? err.message : "Invalid draft approval request",
        code: err?.code || "INVALID_DRAFT_APPROVAL",
      });
    }
  });

  // Retrieve an approved draft by id
  router.get("/drafts/:draftId", async (req, res) => {
    try {
      const draft = await integrationService.getDraft(req.params.draftId);
      if (!draft) {
        return res.status(404).json({ error: `Draft '${req.params.draftId}' not found`, code: "DRAFT_NOT_FOUND" });
      }
      res.json({ ok: true, draft });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL_ERROR" });
    }
  });

  // Safe Mock Publishing simulation (Phase 3A)
  router.post("/publish-mock", async (req, res) => {
    try {
      const attempt = await integrationService.publishMockDraft(req.body || {});
      res.status(200).json({ ok: true, attempt });
    } catch (err: any) {
      const statusCode = err?.statusCode || (err?.code === "CONFLICT" ? 409 : 500);
      res.status(statusCode).json({
        ok: false,
        error: err instanceof Error ? err.message : "Mock publishing failed",
        code: err?.code || "MOCK_PUBLISH_ERROR",
      });
    }
  });

  // Retrieve publishing attempts for a draft
  router.get("/publish-attempts/draft/:draftId", async (req, res) => {
    try {
      const attempts = await integrationService.getAttemptsForDraft(req.params.draftId);
      res.json({ ok: true, attempts });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL_ERROR" });
    }
  });

  // Retrieve a specific publishing attempt
  router.get("/publish-attempts/:attemptId", async (req, res) => {
    try {
      const attempt = await integrationService.getAttempt(req.params.attemptId);
      if (!attempt) {
        return res.status(404).json({ error: `Attempt '${req.params.attemptId}' not found`, code: "ATTEMPT_NOT_FOUND" });
      }
      res.json({ ok: true, attempt });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL_ERROR" });
    }
  });

  // Multi-platform status across Drive, Instagram, LinkedIn, and X
  router.get("/platform-status", async (_req, res) => {
    try {
      const status = await publishingService.getPlatformStatuses();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load platform status" });
    }
  });

  // Generates secure LinkedIn OAuth authorization URL with CSRF state
  router.get("/linkedin/auth-url", async (req, res) => {
    try {
      const redirectUri = typeof req.query.redirect_uri === "string" ? req.query.redirect_uri : undefined;
      const auth = await publishingService.getLinkedInAuthUrl(redirectUri);
      res.json(auth);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to generate authorization URL" });
    }
  });

  // Handles OAuth redirect callback from LinkedIn
  router.get("/linkedin/callback", async (req, res) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;
    const errorDescription = req.query.error_description as string;

    if (error) {
      return res.status(400).send(`
        <html><body>
          <h2>LinkedIn Authorization Failed</h2>
          <p>${error}: ${errorDescription || "User denied or cancelled authorization."}</p>
          <a href="/">Return to AdaL-Nexus</a>
        </body></html>
      `);
    }

    if (!code || !state) {
      return res.status(400).send("Missing code or state parameter.");
    }

    try {
      const account = await publishingService.handleLinkedInCallback(code, state);
      // Friendly HTML response that can postMessage back to opener or redirect home
      res.send(`
        <html>
          <head><title>LinkedIn Connected</title></head>
          <body style="font-family:sans-serif;text-align:center;padding:50px;">
            <h2 style="color:#0a66c2;">LinkedIn Successfully Connected!</h2>
            <p>Authenticated as <strong>${account.name}</strong> (${account.memberUrn})</p>
            <p>You can close this window now.</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: "LINKEDIN_AUTH_SUCCESS", account: ${JSON.stringify({ name: account.name, urn: account.memberUrn })} }, "*");
                setTimeout(() => window.close(), 1500);
              } else {
                setTimeout(() => window.location.href = "/", 2000);
              }
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      res.status(400).send(`
        <html><body>
          <h2>LinkedIn Connection Error</h2>
          <p>${err.message || "OAuth exchange failed"}</p>
          <a href="/">Return to AdaL-Nexus</a>
        </body></html>
      `);
    }
  });

  // Alternative JSON endpoint for exchanging code programmatically
  router.post("/linkedin/exchange-code", async (req, res) => {
    const { code, state, redirectUri } = req.body || {};
    if (!code || !state) {
      return res.status(400).json({ error: "Missing required code or state parameter." });
    }

    try {
      const account = await publishingService.handleLinkedInCallback(code, state, redirectUri);
      res.json({
        ok: true,
        account: {
          memberUrn: account.memberUrn,
          name: account.name,
          email: account.email,
          pictureUrl: account.pictureUrl,
          expiresAt: account.expiresAt,
        },
      });
    } catch (err: any) {
      res.status(err.statusCode || 400).json({ error: err.message || "OAuth exchange failed" });
    }
  });

  // Disconnects LinkedIn account
  router.delete("/linkedin/disconnect", async (_req, res) => {
    try {
      await publishingService.disconnectLinkedIn();
      res.json({ ok: true, message: "LinkedIn account disconnected." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to disconnect LinkedIn account" });
    }
  });

  // Validates user-provided image (file existence, magic bytes, dimensions, 10MB limit)
  router.post("/validate-image", async (req, res) => {
    try {
      const result = await validateUserImage(req.body || {});
      res.status(result.valid ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ valid: false, error: err.message || "Image validation failed" });
    }
  });

  // Generates tailored captions for selected platforms (LinkedIn, Twitter, Instagram)
  router.post("/generate-multi-captions", async (req, res) => {
    try {
      const result = await multiCaptionService.generate(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to generate multi-platform captions" });
    }
  });

  // Publishes approved multi-platform posts with mandatory approval gate
  router.post("/publish-multi", async (req, res) => {
    try {
      const response = await publishingService.publishMultiPlatform(req.body || {});
      res.status(200).json(response);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Publishing request rejected", code: "PUBLISH_REJECTED" });
    }
  });

  return router;
}
